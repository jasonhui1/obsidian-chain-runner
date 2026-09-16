import type { App } from 'obsidian'
import { chainIsUnset, type ChainNodeData, type MaybeNodeElement, type NodeRunStatus, type NodeTarget } from './chainNode'
import type { DrawingView, NodeReading, NodeSurface, PlacedOutput } from './excalidraw'
import type { Box } from './nodeScene'
import type { OutputNotes } from './outputNotes'
import { CHAIN_GONE, NODE_GONE } from './chainNodes'
import { runIntoNotes, type ChainRunOutcome } from './chainRun'
import { openLiveOutputs, type LiveOutput } from './liveOutputs'
import type { RunLayout } from '../run/panels'
import { buildRunFrame, type FramedPanel, type RunFrame } from '../run/runFrame'
import { seedFromInputs } from './inputSeed'
import { onDrawing, UNREACHABLE_DRAWING } from './onDrawing'
import { runFailure } from '../run/session'
import { streamsOutputs, UNSUPPORTED_STREAMING } from '../run/stream'
import type { EngineClient } from '../engine/client'
import type { ChainSummary, LayoutModel } from '../engine/types'

/**
 * Running a chain node: the arrows in become the seed, and the outputs become
 * notes that fill in place on the drawing (ADR-0003). What is bound in is
 * `./nodeScene.ts`; where each output lands is `../run/runFrame.ts`.
 */

export const NO_INPUTS =
  'Nothing is bound into this chain node. Draw an arrow into it from a text block or an embedded note.'

export const SOME_UNBOUND = (count: number): string =>
  count === 1
    ? 'One arrow into this node came from nothing readable, and was skipped.'
    : `${count} arrows into this node came from nothing readable, and were skipped.`

export const ALREADY_RUNNING = 'This chain node is already running.'

export const PICK_A_CHAIN = 'This node has no chain yet. Click its top line to pick one.'

export const NOTHING_WRITTEN = 'The run did not finish, so nothing was written.'

export const NO_OUTPUTS = 'The run finished without producing any output.'

export const NO_FRAME =
  'This Excalidraw cannot make frames, so the outputs were placed loose beside the node. Update it to group them.'

export interface NodeRunDeps {
  app: App
  engine: EngineClient
  /** Offline is a notice and nothing else. */
  withEngine: <T>(action: () => Promise<T>) => Promise<T | undefined>
  notify: (message: string) => void
  markOffline: () => void
  surface: NodeSurface
  notes: OutputNotes
}

/** One run of one node, as the click assembled it. */
interface NodeRunPlan {
  chain: ChainSummary
  seed: string
  target: NodeTarget
  /** The click's own view — the only handle on a drawing embedded in a note. */
  view: DrawingView | undefined
  node: Box
  parameterValue?: string
}

export class NodeRun {
  /** One run per node. A node's second click while it runs is not a second run. */
  private readonly inFlight = new Map<string, AbortController>()

  constructor(private readonly deps: NodeRunDeps) {}

  /** A click on a node's `▶ Run`. */
  async run(data: ChainNodeData, element: MaybeNodeElement, view?: DrawingView): Promise<void> {
    const target: NodeTarget = {
      nodeId: data.nodeId,
      ...(element.groupIds ? { groupIds: element.groupIds } : {}),
    }
    if (this.inFlight.has(data.nodeId)) {
      this.deps.notify(ALREADY_RUNNING)
      return
    }
    // Claimed before the first await: the checks below reach the engine.
    const controller = new AbortController()
    this.inFlight.set(data.nodeId, controller)
    try {
      await this.attempt(data, target, view, controller)
    } finally {
      if (this.inFlight.get(data.nodeId) === controller) this.inFlight.delete(data.nodeId)
    }
  }

  /** Everything a click does once the node has been claimed for this run. */
  private async attempt(
    data: ChainNodeData,
    target: NodeTarget,
    view: DrawingView | undefined,
    controller: AbortController,
  ): Promise<void> {
    if (chainIsUnset(data)) {
      this.deps.notify(PICK_A_CHAIN)
      return
    }
    const unavailable = this.deps.surface.unavailable()
    if (unavailable) {
      this.deps.notify(unavailable)
      return
    }

    const reading = this.read(target, view)
    if (!reading) return

    const workspace = await this.deps.withEngine(() => this.deps.engine.loadWorkspace())
    if (!workspace) return
    if (!streamsOutputs(workspace.capabilities)) {
      this.deps.notify(UNSUPPORTED_STREAMING)
      return
    }
    const chain = workspace.chains.find(one => one.slug === data.chain)
    if (!chain) {
      this.deps.notify(CHAIN_GONE(data.chainName))
      return
    }

    const seed = await seedFromInputs({
      app: this.deps.app,
      notify: this.deps.notify,
      inputs: reading.inputs.inputs,
      drawing: reading.drawing,
    })
    if (reading.inputs.unbound > 0) this.deps.notify(SOME_UNBOUND(reading.inputs.unbound))
    // A chain that pins its own files reads nothing from the drawing.
    if (seed === '' && chain.seeded !== false) {
      this.deps.notify(NO_INPUTS)
      return
    }

    const plan: NodeRunPlan = {
      chain,
      seed,
      target,
      view,
      node: reading.box,
      ...(data.parameterValue ? { parameterValue: data.parameterValue } : {}),
    }
    await this.launch(plan, controller)
  }

  /** Whether that node has a run going; a chain is not changed underneath one. */
  isRunning(nodeId: string): boolean {
    return this.inFlight.has(nodeId)
  }

  /** Drops every run in flight — the plugin is unloading. */
  stop(): void {
    for (const controller of this.inFlight.values()) controller.abort()
    this.inFlight.clear()
  }

  /** What the node is bound to and where it sits, or a notice and nothing. */
  private read(target: NodeTarget, view: DrawingView | undefined): NodeReading | undefined {
    try {
      const reading = this.deps.surface.read(target, view)
      if (reading) return reading
      this.deps.notify(NODE_GONE)
    } catch (error) {
      this.deps.notify(error instanceof Error ? error.message : UNREACHABLE_DRAWING)
    }
    return undefined
  }

  private async launch(plan: NodeRunPlan, controller: AbortController): Promise<void> {
    const { chain, seed, target, view, parameterValue } = plan

    let said = ''
    // Every write to a drawing is a save, so only a change of words earns one.
    const say = async (status: NodeRunStatus): Promise<void> => {
      const next = JSON.stringify(status)
      if (next === said) return
      said = next
      await this.onDrawing(() => this.deps.surface.setRunStatus(target, status, view))
    }

    await say({ kind: 'running', done: 0 })

    const outcome = await runIntoNotes({
      engine: this.deps.engine,
      chain,
      request: {
        chainName: chain.name,
        seedPrompt: seed,
        ...(parameterValue ? { paramValue: parameterValue } : {}),
      },
      signal: controller.signal,
      notify: this.deps.notify,
      markOffline: this.deps.markOffline,
      onProgress: model => say(progress(model)),
      place: (runId, layout) => this.open(runId, layout, plan),
    })
    // Dropped by an unload: the notes stay as a record of a real run.
    if (outcome.aborted) return

    await this.finish(outcome, plan)
  }

  /** One empty note per declared output, placed in the frame. */
  private async open(runId: string, layout: RunLayout, plan: NodeRunPlan): Promise<LiveOutput<FramedPanel>[]> {
    const frame = buildRunFrame({ layout, chainName: plan.chain.name, runId, node: plan.node })
    // A refused note has said so already; the rest of the run still lands.
    const outputs = await openLiveOutputs({
      places: frame.panels,
      notes: this.deps.notes,
      run: { runId, chainName: plan.chain.name },
    })

    const placed: PlacedOutput[] = outputs.map(one => ({ placed: one.place, note: one.note.file }))
    await this.place(frame, placed, plan.view)
    return outputs
  }

  /**
   * The outputs take their final text and the node says how it went. A run that
   * produced no panels is done, not failed — an empty answer is still an answer.
   */
  private async finish(run: ChainRunOutcome<FramedPanel>, plan: NodeRunPlan): Promise<void> {
    const { target, view } = plan
    const error = runFailure(run.state)
    if (error && error !== run.failure) this.deps.notify(error)
    // The reason goes onto the node too: a notice is gone when the reader looks back.
    const settled: NodeRunStatus = error ? { kind: 'failed', error } : { kind: 'done' }

    // Nothing was placed: a run that never named itself failed, and one that named
    // itself and declared no panels gave an empty answer.
    if (!run.live) {
      if (!run.state.runId) {
        if (!error) this.deps.notify(NOTHING_WRITTEN)
        await this.onDrawing(() =>
          this.deps.surface.setRunStatus(target, { kind: 'failed', ...(error ? { error } : {}) }, view),
        )
        return
      }
      this.deps.notify(NO_OUTPUTS)
    }
    await this.onDrawing(() => this.deps.surface.setRunStatus(target, settled, view))
  }

  /** Puts the frame on the drawing, saying so when it could not be a real frame. */
  private async place(frame: RunFrame, outputs: PlacedOutput[], view: DrawingView | undefined): Promise<void> {
    await this.onDrawing(async () => {
      if (!(await this.deps.surface.placeRun(frame, outputs, view))) this.deps.notify(NO_FRAME)
      return true
    })
  }

  /** Touches the drawing, saying so rather than throwing when it cannot. */
  private async onDrawing(action: () => Promise<boolean>): Promise<void> {
    if ((await onDrawing(action, this.deps.notify)) === false) this.deps.notify(NODE_GONE)
  }
}

/** Panels landed, out of panels declared; the total arrives with the first frame. */
function progress(model: LayoutModel | undefined): NodeRunStatus {
  if (!model || model.panels.length === 0) return { kind: 'running', done: 0 }
  return {
    kind: 'running',
    done: model.panels.filter(panel => panel.state !== 'pending').length,
    total: model.panels.length,
  }
}
