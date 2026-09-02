import type { App } from 'obsidian'
import { ChainPicker, ParameterPicker } from './chainPicker'
import { buildChainNode, chainNodeData, type MaybeNodeElement, type NodeTarget } from './chainNode'
import type { NodeSurface } from './excalidraw'
import type { EngineClient } from '../engine/client'
import { parameterToAsk, type ChainSummary } from '../engine/types'

/**
 * Chain nodes on a drawing: putting one there, and answering a click on it.
 *
 * The node's shape is `./chainNode.ts` and the drawing is behind `NodeSurface`,
 * so what is left here is the decisions — what is asked before anything is
 * placed, and what each of the node's two links means. Both are the ticket's
 * acceptance criteria, and both are checkable without a vault.
 */

export const NO_DRAWING = 'Open an Excalidraw drawing to add a chain node to it'

/**
 * A node's identity, made once when it is placed.
 *
 * Not an Excalidraw element id: those are re-made when a node is copied, and a
 * copy is meant to be its own node while its five elements stay one node.
 */
export function newNodeId(): string {
  return `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Said on a Run click. The click is still swallowed; only the run is missing (#9). */
export const RUN_NOT_WIRED = 'Running a chain node arrives in the next ticket — for now, use “Run chain on this note”.'

/** The node names a chain the engine no longer has; the drawing outlived the workspace. */
export const CHAIN_GONE = (chainName: string): string =>
  `${chainName} is no longer in the workspace, so there is nothing to choose from.`

export const NO_PARAMETER = (chainName: string): string => `${chainName} no longer declares a dropdown.`

/** The node was deleted between the click and the pick. */
export const NODE_GONE = 'That chain node is no longer on this drawing.'

export interface ChainNodesDeps {
  app: App
  engine: EngineClient
  /** Every call that needs the engine goes through this; offline is a notice and nothing else. */
  withEngine: <T>(action: () => Promise<T>) => Promise<T | undefined>
  notify: (message: string) => void
  surface: NodeSurface
  /** A fresh identity for a node, injected so a placed node is checkable. */
  newNodeId: () => string
}

export class ChainNodes {
  constructor(private readonly deps: ChainNodesDeps) {}

  /**
   * The "Add chain node" command.
   *
   * Everything that could stop the action is checked before the picker opens —
   * Excalidraw, the drawing, the engine, the workspace — so a reader who gets as
   * far as choosing a chain gets a node.
   */
  async add(): Promise<void> {
    const unavailable = this.deps.surface.unavailable()
    if (unavailable) {
      this.deps.notify(unavailable)
      return
    }
    if (!this.deps.surface.hasActiveDrawing()) {
      this.deps.notify(NO_DRAWING)
      return
    }

    const chains = await this.deps.withEngine(() => this.deps.engine.listChains())
    if (!chains) return
    if (chains.length === 0) {
      this.deps.notify('No chains in the workspace')
      return
    }

    new ChainPicker(this.deps.app, chains, chain => this.place(chain), {
      placeholder: 'Add which chain to this drawing?',
      // The node's inputs are the arrows bound into it (#9), so what a chain does
      // with a note is not what the reader is deciding here.
      unseeded: 'reads its own files — bound inputs are not used',
    }).open()
  }

  /**
   * A click on a link the drawing is about to open. `false` swallows it
   * (`docs/spike-ea.md`, Q1).
   *
   * Every element of a chain node is answered, not just the two that carry a
   * link: a reader who copies a node and pastes it somewhere odd should never
   * find one of our links opening a browser or making a note.
   */
  handleLinkClick(element: MaybeNodeElement): boolean {
    const data = chainNodeData(element)
    // Not ours: a wiki link the reader drew themselves, and theirs to follow.
    if (!data) return true
    if (data.role === 'run') this.deps.notify(RUN_NOT_WIRED)
    if (data.role === 'parameter') {
      // The clicked element's groups come along, so a node that was copied is
      // rewritten on its own rather than on both copies (`./chainNode.ts`).
      void this.editParameter(data.chain, data.chainName, {
        nodeId: data.nodeId,
        ...(element.groupIds ? { groupIds: element.groupIds } : {}),
      })
    }
    return false
  }

  /** Places the node, asking for the chain's dropdown first when it declares one. */
  private place(chain: ChainSummary): void {
    const parameter = parameterToAsk(chain)
    if (!parameter) {
      void this.put(chain, undefined)
      return
    }
    new ParameterPicker(this.deps.app, parameter.name, parameter.options, value => {
      void this.put(chain, value)
    }).open()
  }

  private async put(chain: ChainSummary, parameterValue: string | undefined): Promise<void> {
    const elements = buildChainNode(chain, { nodeId: this.deps.newNodeId(), ...(parameterValue ? { parameterValue } : {}) })
    try {
      await this.deps.surface.place(elements)
    } catch (error) {
      this.deps.notify(error instanceof Error ? error.message : 'Could not reach that drawing')
    }
  }

  /** The dropdown line: the chain's own options, and the pick written back in place. */
  private async editParameter(slug: string, chainName: string, target: NodeTarget): Promise<void> {
    const chains = await this.deps.withEngine(() => this.deps.engine.listChains())
    if (!chains) return
    const chain = chains.find(one => one.slug === slug)
    if (!chain) {
      this.deps.notify(CHAIN_GONE(chainName))
      return
    }
    const parameter = parameterToAsk(chain)
    if (!parameter) {
      this.deps.notify(NO_PARAMETER(chain.name))
      return
    }
    new ParameterPicker(this.deps.app, parameter.name, parameter.options, value => {
      void this.rewrite(target, value)
    }).open()
  }

  private async rewrite(target: NodeTarget, value: string): Promise<void> {
    try {
      if (!(await this.deps.surface.setParameter(target, value))) this.deps.notify(NODE_GONE)
    } catch (error) {
      this.deps.notify(error instanceof Error ? error.message : 'Could not reach that drawing')
    }
  }
}
