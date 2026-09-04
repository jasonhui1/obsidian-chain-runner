import type { App } from 'obsidian'
import { ChainPicker, ParameterPicker } from './chainPicker'
import {
  buildChainNode,
  chainNodeData,
  chainNodeRole,
  type ChainNodeData,
  type MaybeNodeElement,
  type NodeTarget,
} from './chainNode'
import type { DrawingView, NodeSurface } from './excalidraw'
import type { Point } from './panelSpot'
import type { EngineClient } from '../engine/client'
import { parameterToAsk, type ChainSummary } from '../engine/types'

/**
 * Chain nodes on a drawing: putting one there, and answering a click on it. The
 * node's shape is `./chainNode.ts` and the drawing is behind `NodeSurface`, so
 * only the decisions are here.
 */

export const NO_DRAWING = 'Open an Excalidraw drawing to add a chain node to it'

export const NO_CHAINS = 'No chains in the workspace'

/** A node's identity, made once when it is placed. Not an element id — those change on copy. */
export function newNodeId(): string {
  return `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** The node names a chain the engine no longer has; the drawing outlived the workspace. */
export const CHAIN_GONE = (chainName: string): string =>
  `${chainName} is no longer in the workspace, so there is nothing to choose from.`

export const NO_PARAMETER = (chainName: string): string => `${chainName} no longer declares a dropdown.`

/** The node was deleted between the click and the pick. */
export const NODE_GONE = 'That chain node is no longer on this drawing.'

/** A chain changed mid-run would leave the node saying one thing and running another. */
export const RUNNING_NOW = 'This chain node is running. Wait for it to finish before changing its chain.'

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
  /** Whether that node is running right now, which is when its chain is not changed. */
  isRunning: (nodeId: string) => boolean
  /**
   * Answered once the press behind a selection ends: where it was if it was a
   * click, `undefined` if it was a drag, a keyboard selection or no press at
   * all. Both the gate on opening a picker and where it opens (ADR-0010).
   */
  clickSpot: (settled: (at: Point | undefined) => void) => void
  /** Where the reader last pressed, for the routes that already know a click happened. */
  pressSpot: () => Point | undefined
}

export class ChainNodes {
  /** The drawing a node was last selected on — an embedded one is not a tab. */
  private lastView: DrawingView | undefined

  constructor(private readonly deps: ChainNodesDeps) {}

  /** The "Add chain node" command: a chain picked first, then a node holding it. */
  async add(): Promise<void> {
    if (!this.usable() || !this.onADrawing()) return
    await this.pickChain('Add which chain to this drawing?', chain =>
      this.withParameter(chain, value => void this.put(chain, value)),
    )
  }

  /**
   * The toolbar button's node: dropped with no chain at all, because the chain is
   * picked on the node itself. The click carries its own view, so a drawing
   * embedded in a note is a place to drop one too.
   */
  async placeUnset(view?: DrawingView): Promise<void> {
    if (!this.usable()) return
    // Only the palette needs a drawing in front of the reader; a click brought its own.
    if (!view && !this.onADrawing()) return
    const nodeId = this.deps.newNodeId()
    await this.onDrawing(() => this.deps.surface.place(buildChainNode(undefined, { nodeId }), view))
  }

  /**
   * A click on a link the drawing is about to open; `false` swallows it
   * (`docs/spike-ea.md`, Q1). Every element of a node is answered, so none of our
   * links ever opens anything.
   */
  handleLinkClick(element: MaybeNodeElement, view?: DrawingView): boolean {
    const data = chainNodeData(element)
    // Not ours: a wiki link the reader drew themselves, and theirs to follow.
    if (!data) return true
    if (chainNodeRole(data.role) === 'run') this.deps.run(data, element, view)
    // Following a link is already a click; only where it was is in question.
    else this.openDecision(data, element, this.deps.pressSpot(), view)
    return false
  }

  /**
   * A plain click, which Excalidraw reports as a change of selection
   * (ADR-0010). It reaches the two lines that open a picker; a run is not one,
   * because selecting a node is not asking to run it and a run is not undone.
   */
  handleSelection(element: MaybeNodeElement, view?: DrawingView): void {
    const data = chainNodeData(element)
    if (!data) return
    this.lastView = view
    // Nothing opens until the press ends, because a drag starts the same way.
    this.deps.clickSpot(at => {
      if (at) this.openDecision(data, element, at, view)
    })
  }

  /**
   * A double-click, which is how `▶ Run` is reached without a modifier. The
   * second click of one changes no selection, so the scene hook never sees it —
   * the drawing is asked what is selected instead (ADR-0010).
   */
  handleDoubleClick(): void {
    let element: MaybeNodeElement | undefined
    try {
      element = this.deps.surface.selectedNode(this.lastView)
    } catch {
      // Every double-click in the workspace arrives here; only a drawing answers.
      return
    }
    const data = element && chainNodeData(element)
    if (!element || !data || chainNodeRole(data.role) !== 'run') return
    if (!this.usable()) return
    this.deps.run(data, element, this.lastView)
  }

  /**
   * The pointer coming up, which is when a node dragged to a new size has its
   * lines cut again to fit it (ADR-0011). Nothing is written unless a box
   * actually changed width, so a drawing at rest is never saved.
   */
  handleResize(): void {
    try {
      void this.deps.surface.reflow(this.lastView).catch(() => {})
    } catch {
      // Every release in the workspace arrives here; only a drawing answers.
    }
  }

  /** The picker a line opens, if it opens one. `▶ Run` is not one of them. */
  private openDecision(
    data: ChainNodeData,
    element: MaybeNodeElement,
    at: Point | undefined,
    view?: DrawingView,
  ): void {
    const role = chainNodeRole(data.role)
    if (role === 'chain') void this.editChain(data, element, at, view)
    if (role === 'parameter') void this.editParameter(data, element, at, view)
  }

  /** The chain line: the same picker the command opens, and the node re-shaped around the pick (ADR-0009). */
  private async editChain(
    data: ChainNodeData,
    element: MaybeNodeElement,
    at: Point | undefined,
    view?: DrawingView,
  ): Promise<void> {
    if (this.deps.isRunning(data.nodeId)) {
      this.deps.notify(RUNNING_NOW)
      return
    }
    if (!this.usable()) return
    const target = this.targetOf(data, element)
    await this.pickChain(
      'Which chain should this node run?',
      chain =>
        this.withParameter(
          chain,
          value =>
            void this.onDrawing(async () => {
              if (!(await this.deps.surface.setChain(target, chain, value, view))) this.deps.notify(NODE_GONE)
            }),
          at,
        ),
      at,
    )
  }

  /** The dropdown line: the chain's own options, and the pick written back in place. */
  private async editParameter(
    data: ChainNodeData,
    element: MaybeNodeElement,
    at: Point | undefined,
    view?: DrawingView,
  ): Promise<void> {
    if (!this.usable()) return
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
    const target = this.targetOf(data, element)
    new ParameterPicker(
      this.deps.app,
      parameter.name,
      parameter.options,
      value => {
        void this.onDrawing(async () => {
          if (!(await this.deps.surface.setParameter(target, value, view))) this.deps.notify(NODE_GONE)
        })
      },
      at,
    ).open()
  }

  private async put(chain: ChainSummary, parameterValue: string | undefined): Promise<void> {
    const nodeId = this.deps.newNodeId()
    await this.onDrawing(() =>
      this.deps.surface.place(buildChainNode(chain, { nodeId, ...(parameterValue ? { parameterValue } : {}) })),
    )
  }

  /**
   * The workspace's chains, offered under `placeholder`. Everything that could
   * stop the action is checked before the picker opens, so a reader who gets as
   * far as choosing a chain gets what they chose.
   */
  private async pickChain(
    placeholder: string,
    onPick: (chain: ChainSummary) => void,
    at?: Point,
  ): Promise<void> {
    const chains = await this.deps.withEngine(() => this.deps.engine.listChains())
    if (!chains) return
    if (chains.length === 0) {
      this.deps.notify(NO_CHAINS)
      return
    }
    new ChainPicker(this.deps.app, chains, onPick, {
      placeholder,
      // A node's inputs are the arrows bound into it (#9), not the note.
      unseeded: 'reads its own files — bound inputs are not used',
      anchor: at,
    }).open()
  }

  /**
   * The chain's dropdown asked for before anything is written: a chain reads its
   * parameter as an input, so a node that arrives unset says something else.
   */
  private withParameter(chain: ChainSummary, write: (value?: string) => void, at?: Point): void {
    const parameter = parameterToAsk(chain)
    if (!parameter) {
      write(undefined)
      return
    }
    new ParameterPicker(this.deps.app, parameter.name, parameter.options, value => write(value), at).open()
  }

  /** Checked on every entry point: a drawing can be opened on an Excalidraw too old to edit it. */
  private usable(): boolean {
    const unavailable = this.deps.surface.unavailable()
    if (!unavailable) return true
    this.deps.notify(unavailable)
    return false
  }

  private onADrawing(): boolean {
    if (this.deps.surface.hasActiveDrawing()) return true
    this.deps.notify(NO_DRAWING)
    return false
  }

  /** Which node on the drawing the click came from; the group tells two copies apart. */
  private targetOf(data: ChainNodeData, element: MaybeNodeElement): NodeTarget {
    return { nodeId: data.nodeId, ...(element.groupIds ? { groupIds: element.groupIds } : {}) }
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
