import type { App } from 'obsidian'
import { ChainPicker, ParameterPicker } from './chainPicker'
import { buildChainNode, chainNodeData, type ChainNodeData, type MaybeNodeElement } from './chainNode'
import type { DrawingView, NodeSurface } from './excalidraw'
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
  /** The run itself is `./nodeRun.ts`. */
  run: (data: ChainNodeData, element: MaybeNodeElement, view?: DrawingView) => void
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
  handleLinkClick(element: MaybeNodeElement, view?: DrawingView): boolean {
    const data = chainNodeData(element)
    // Not ours: a wiki link the reader drew themselves, and theirs to follow.
    if (!data) return true
    // The groups say which copy was clicked; the view is the only handle on a
    // drawing embedded in a note.
    if (data.role === 'run') this.deps.run(data, element, view)
    if (data.role === 'parameter') void this.editParameter(data, element, view)
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
    const nodeId = this.deps.newNodeId()
    await this.onDrawing(() =>
      this.deps.surface.place(buildChainNode(chain, { nodeId, ...(parameterValue ? { parameterValue } : {}) })),
    )
  }

  /** The dropdown line: the chain's own options, and the pick written back in place. */
  private async editParameter(data: ChainNodeData, element: MaybeNodeElement, view?: DrawingView): Promise<void> {
    // Checked on this path too, and not only on the command: a drawing made by a
    // newer Chain Runner can be opened on an Excalidraw too old to edit it with.
    const unavailable = this.deps.surface.unavailable()
    if (unavailable) {
      this.deps.notify(unavailable)
      return
    }
    const chains = await this.deps.withEngine(() => this.deps.engine.listChains())
    if (!chains) return
    const chain = chains.find(one => one.slug === data.chain)
    if (!chain) {
      this.deps.notify(CHAIN_GONE(data.chainName))
      return
    }
    const parameter = parameterToAsk(chain)
    if (!parameter) {
      this.deps.notify(NO_PARAMETER(chain.name))
      return
    }
    const target = { nodeId: data.nodeId, ...(element.groupIds ? { groupIds: element.groupIds } : {}) }
    new ParameterPicker(this.deps.app, parameter.name, parameter.options, value => {
      void this.onDrawing(async () => {
        if (!(await this.deps.surface.setParameter(target, value, view))) this.deps.notify(NODE_GONE)
      })
    }).open()
  }

  /** Runs something against the drawing, saying so rather than throwing when it cannot. */
  private async onDrawing(action: () => Promise<void>): Promise<void> {
    try {
      await action()
    } catch (error) {
      this.deps.notify(error instanceof Error ? error.message : 'Could not reach that drawing')
    }
  }
}
