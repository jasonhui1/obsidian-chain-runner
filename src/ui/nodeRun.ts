import { chainIsUnset, type ChainNodeData, type MaybeNodeElement, type NodeRunStatus, type NodeTarget } from './chainNode'
import type { DrawingView, NodeReading, PlacedOutput, RunDrawing, RunSurface } from './excalidraw'
import type { Box } from './nodeScene'
import type { NoteStore } from './noteStore'
import type { OutputNotes } from './outputNotes'
import { CHAIN_GONE, NODE_GONE } from './chainNodes'
import { runIntoNotes, type ChainRunOutcome } from './chainRun'
import { openLiveOutputs, type LiveOutput } from './liveOutputs'
import type { RunLayout } from '../run/panels'
import { buildRunFrame, RUN_FRAME_GAP, type FramedPanel, type RunFrame } from '../run/runFrame'
import { seedFromInputs } from './inputSeed'
import { onDrawing, readDrawing, UNREACHABLE_DRAWING } from './onDrawing'
import { runFailure } from '../run/session'
import { streamsOutputs, UNSUPPORTED_STREAMING } from '../run/stream'
import type { EngineClient } from '../engine/client'
import type { ChainSummary, LayoutModel, LayoutPanel, RunEvent, VarianceMemberEvent } from '../engine/types'

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
export const INVALID_RUN_COUNT = 'Set the run count to a whole number from 1 to 10.'
export const VARIANCE_UNSUPPORTED = 'This engine does not support multiple runs. Set the count to 1.'

export const NO_FRAME =
  'This Excalidraw cannot make frames, so the outputs were placed loose beside the node. Update it to group them.'

export interface NodeRunDeps {
  store: NoteStore
  engine: EngineClient
  /** Offline is a notice and nothing else. */
  withEngine: <T>(action: () => Promise<T>) => Promise<T | undefined>
  notify: (message: string) => void
  markOffline: () => void
  /** Writes the hold note of a run that reached a hold. */
  holdReached: (runId: string, nodeId: string) => Promise<void>
  surface: RunSurface
  notes: OutputNotes
}

/** One write to a run's drawing; `false` means the node is no longer there. */
type Touch = (write: (drawing: RunDrawing) => Promise<boolean>) => Promise<void>

/** One run of one node, as the click assembled it. */
interface NodeRunPlan {
  chain: ChainSummary
  seed: string
  target: NodeTarget
  /** Writes to the drawing the click came from, bound once for the whole run. */
  touch: Touch
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

    // The click's own view, or else the tab in front, bound once for the whole run.
    const drawing = readDrawing(() => this.deps.surface.on(view), this.deps.notify)
    if (!drawing) return
    // Embedded drawings are not workspace leaves, so upgrade on their own gesture.
    if ((await onDrawing(() => drawing.upgradeRunCounts(), this.deps.notify)) === undefined) return
    const reading = this.read(target, drawing)
    if (!reading) return
    const count = parseRunCount(reading.runCount ?? '1')
    if (count === undefined) {
      this.deps.notify(INVALID_RUN_COUNT)
      return
    }

    const chains = await this.deps.withEngine(() => this.deps.engine.listChains())
    if (!chains) return
    const capabilities = await this.deps.engine.capabilities()
    if (!streamsOutputs(capabilities)) {
      this.deps.notify(UNSUPPORTED_STREAMING)
      return
    }
    if (count > 1 && capabilities.varianceGroups !== true) {
      this.deps.notify(VARIANCE_UNSUPPORTED)
      return
    }
    const chain = chains.find(one => one.slug === data.chain)
    if (!chain) {
      this.deps.notify(CHAIN_GONE(data.chainName))
      return
    }

    const seed = await seedFromInputs({
      store: this.deps.store,
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
      touch: this.toucher(drawing),
      node: reading.box,
      ...(data.parameterValue ? { parameterValue: data.parameterValue } : {}),
    }
    await this.launch(plan, controller, count)
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
  private read(target: NodeTarget, drawing: RunDrawing): NodeReading | undefined {
    try {
      const reading = drawing.read(target)
      if (reading) return reading
      this.deps.notify(NODE_GONE)
    } catch (error) {
      this.deps.notify(error instanceof Error ? error.message : UNREACHABLE_DRAWING)
    }
    return undefined
  }

  private async launch(plan: NodeRunPlan, controller: AbortController, count: number): Promise<void> {
    const runPlan = count > 1 ? { ...plan, touch: serializeTouch(plan.touch) } : plan
    const { chain, target, touch } = runPlan

    let lastStatus = ''
    // Every write to a drawing is a save, so only a change of words earns one.
    const say = async (status: NodeRunStatus): Promise<void> => {
      const next = JSON.stringify(status)
      if (next === lastStatus) return
      lastStatus = next
      await touch(drawing => drawing.setRunStatus(target, status))
    }

    await say({ kind: 'running', done: 0 })

    if (count > 1) {
      await this.launchVariance(runPlan, controller, count, say)
      return
    }

    const outcome = await runIntoNotes({
      engine: this.deps.engine,
      chain,
      request: requestOf(runPlan),
      signal: controller.signal,
      notify: this.deps.notify,
      markOffline: this.deps.markOffline,
      holdReached: this.deps.holdReached,
      onProgress: model => say(progress(model)),
      place: (runId, layout) => this.open(runId, layout, runPlan),
    })
    // Dropped by an unload: the notes stay as a record of a real run.
    if (outcome.aborted) return

    await this.finish(outcome, runPlan)
  }

  /** Runs one variance member per stream, keeping each run's output on its own frame. */
  private async launchVariance(
    plan: NodeRunPlan,
    controller: AbortController,
    count: number,
    say: (status: NodeRunStatus) => Promise<void>,
  ): Promise<void> {
    const queues = Array.from({ length: count }, () => new RunEventQueue())
    const layouts: (LayoutModel | undefined)[] = Array.from({ length: count })
    const notified = new Set<string>()
    const notify = (message: string): void => {
      if (notified.has(message)) return
      notified.add(message)
      this.deps.notify(message)
    }
    let markedOffline = false
    const markOffline = (): void => {
      if (markedOffline) return
      markedOffline = true
      this.deps.markOffline()
    }
    let nextFrameY = plan.node.y

    const members = queues.map((events, instance) =>
      runIntoNotes({
        engine: this.deps.engine,
        chain: plan.chain,
        events,
        signal: controller.signal,
        notify,
        markOffline,
        holdReached: this.deps.holdReached,
        onProgress: model => {
          layouts[instance] = model
          return say(varianceProgress(layouts))
        },
        place: (runId, layout) =>
          this.open(runId, layout, plan, { ...plan.node, y: nextFrameY }, frame => {
            nextFrameY = frame.box.y + frame.box.height + RUN_FRAME_GAP
          }),
      }),
    )
    const allMembers = Promise.allSettled(members)

    let groupId: string | undefined
    let protocolFailure: string | undefined
    let sourceFailure: unknown
    try {
      for await (const event of this.deps.engine.launchVariance({ ...requestOf(plan), count }, controller.signal)) {
        if (event.type === 'variance_complete' && 'groupId' in event && typeof event.groupId === 'string') {
          groupId = event.groupId
          continue
        }
        const member = event as VarianceMemberEvent
        if (!Number.isInteger(member.instance) || member.instance < 0 || member.instance >= count) {
          protocolFailure = `The engine sent an invalid run number for a ${count}-run variance.`
          break
        }
        queues[member.instance]?.push(member)
      }
    } catch (error) {
      sourceFailure = error
    }

    if (sourceFailure !== undefined) queues.forEach(queue => queue.close(sourceFailure))
    else if (protocolFailure) {
      queues.forEach(queue => queue.push({ type: 'error', error: protocolFailure! }))
      queues.forEach(queue => queue.close())
    } else queues.forEach(queue => queue.close())

    const settled = await allMembers
    const outcomes: ChainRunOutcome<FramedPanel>[] = []
    for (const member of settled) {
      if (member.status === 'rejected') throw member.reason
      outcomes.push(member.value)
    }
    if (controller.signal.aborted || outcomes.some(outcome => outcome.aborted)) return

    const failures: string[] = []
    for (const outcome of outcomes) {
      const error = runFailure(outcome.state) ?? outcome.failure
      if (error) {
        failures.push(error)
        if (error !== outcome.failure) notify(error)
      } else if (!outcome.state.runId) {
        failures.push(NOTHING_WRITTEN)
        notify(NOTHING_WRITTEN)
      }
      if (!outcome.live && outcome.state.runId) notify(NO_OUTPUTS)
    }
    if (protocolFailure) failures.push(protocolFailure)
    if (!groupId && !sourceFailure && !protocolFailure) {
      const failure = 'The engine ended the variance run without naming its group.'
      failures.push(failure)
      notify(failure)
    }

    await say(failures.length > 0 ? { kind: 'failed', error: failures[0] } : { kind: 'done' })
  }

  /** One empty note per declared output, placed in the frame. */
  private async open(
    runId: string,
    layout: RunLayout,
    plan: NodeRunPlan,
    node: Box = plan.node,
    onFrame?: (frame: RunFrame) => void,
  ): Promise<LiveOutput<FramedPanel>[]> {
    const frame = buildRunFrame({ layout, chainName: plan.chain.name, runId, node })
    onFrame?.(frame)
    return this.openFrame(frame, plan)
  }

  private async openFrame(frame: RunFrame, plan: NodeRunPlan): Promise<LiveOutput<FramedPanel>[]> {
    // A refused note has said so already; the rest of the run still lands.
    const outputs = await openLiveOutputs({
      places: frame.panels,
      notes: this.deps.notes,
      run: { runId: frame.runId, chainName: plan.chain.name },
    })

    const placed: PlacedOutput[] = outputs.map(one => ({ placed: one.place, notePath: one.note.path }))
    await this.place(frame, placed, plan.touch)
    return outputs
  }

  /**
   * The outputs take their final text and the node says how it went. A run that
   * produced no panels is done, not failed — an empty answer is still an answer.
   */
  private async finish(run: ChainRunOutcome<FramedPanel>, plan: NodeRunPlan): Promise<void> {
    const { target, touch } = plan
    const error = runFailure(run.state)
    if (error && error !== run.failure) this.deps.notify(error)
    // The reason goes onto the node too: a notice is gone when the reader looks back.
    const settled: NodeRunStatus = error ? { kind: 'failed', error } : { kind: 'done' }

    // Nothing was placed: a run that never named itself failed, and one that named
    // itself and declared no panels gave an empty answer.
    if (!run.live) {
      if (!run.state.runId) {
        if (!error) this.deps.notify(NOTHING_WRITTEN)
        await touch(drawing => drawing.setRunStatus(target, { kind: 'failed', ...(error ? { error } : {}) }))
        return
      }
      this.deps.notify(NO_OUTPUTS)
    }
    await touch(drawing => drawing.setRunStatus(target, settled))
  }

  /** Puts the frame on the drawing, saying so when it could not be a real frame. */
  private async place(frame: RunFrame, outputs: PlacedOutput[], touch: Touch): Promise<void> {
    await touch(async drawing => {
      if (!(await drawing.placeRun(frame, outputs))) this.deps.notify(NO_FRAME)
      return true
    })
  }

  /**
   * Writes to `drawing`, saying so rather than throwing when it cannot. A drawing
   * that could not be written to is said once and left alone for the rest of the run.
   */
  private toucher(drawing: RunDrawing): Touch {
    let lost = false
    return async write => {
      if (lost) return
      const done = await onDrawing(() => write(drawing), this.deps.notify)
      if (done === undefined) lost = true
      if (done === false) this.deps.notify(NODE_GONE)
    }
  }
}

/** Panels landed, out of panels declared; the total arrives with the first frame. */
function progress(model: LayoutModel | undefined): NodeRunStatus {
  return progressForPanels(model?.panels ?? [])
}

function varianceProgress(models: readonly (LayoutModel | undefined)[]): NodeRunStatus {
  const panels = models.flatMap(model => model?.panels ?? [])
  return progressForPanels(panels)
}

function progressForPanels(panels: readonly LayoutPanel[]): NodeRunStatus {
  if (panels.length === 0) return { kind: 'running', done: 0 }
  return {
    kind: 'running',
    done: panels.filter(panel => panel.state !== 'pending').length,
    total: panels.length,
  }
}

function parseRunCount(value: string): number | undefined {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const count = Number(trimmed)
  return Number.isInteger(count) && count >= 1 && count <= 10 ? count : undefined
}

function requestOf(plan: NodeRunPlan): { chainName: string; seedPrompt: string; paramValue?: string } {
  return {
    chainName: plan.chain.name,
    seedPrompt: plan.seed,
    ...(plan.parameterValue ? { paramValue: plan.parameterValue } : {}),
  }
}

function serializeTouch(touch: Touch): Touch {
  let previous = Promise.resolve()
  return async write => {
    const current = previous.then(() => touch(write))
    previous = current.catch(() => undefined)
    await current
  }
}

class RunEventQueue implements AsyncIterable<RunEvent>, AsyncIterator<RunEvent> {
  private readonly events: RunEvent[] = []
  private readonly waiting: {
    resolve: (result: IteratorResult<RunEvent>) => void
    reject: (failure: unknown) => void
  }[] = []
  private closed = false
  private failed = false
  private failure: unknown

  [Symbol.asyncIterator](): AsyncIterator<RunEvent> {
    return this
  }

  push(event: RunEvent): void {
    if (this.closed) return
    const next = this.waiting.shift()
    if (next) next.resolve({ done: false, value: event })
    else this.events.push(event)
  }

  close(failure?: unknown): void {
    if (this.closed) return
    this.closed = true
    this.failed = failure !== undefined
    this.failure = failure
    while (this.waiting.length > 0) {
      const next = this.waiting.shift()!
      if (this.failed) next.reject(this.failure)
      else next.resolve({ done: true, value: undefined })
    }
  }

  next(): Promise<IteratorResult<RunEvent>> {
    const event = this.events.shift()
    if (event) return Promise.resolve({ done: false, value: event })
    if (this.closed) {
      return this.failed
        ? Promise.reject(this.failure)
        : Promise.resolve({ done: true, value: undefined })
    }
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }))
  }
}
