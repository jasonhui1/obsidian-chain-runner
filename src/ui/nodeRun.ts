import { TFile, type App } from 'obsidian'
import type { ChainNodeData, MaybeNodeElement, NodeRunStatus, NodeTarget } from './chainNode'
import type { DrawingView, NodeReading, NodeSurface, PlacedOutput } from './excalidraw'
import type { Box, NodeInput } from './nodeScene'
import type { OpenOutputNote, OutputNotes } from './outputNotes'
import { CHAIN_GONE, NODE_GONE } from './chainNodes'
import { buildRunPanels, type RunLayout, type RunPanel } from '../run/panels'
import { buildRunFrame, type RunFrame } from '../run/runFrame'
import { joinSeed, seedFromNote } from '../run/seed'
import { runFailure, settleRun, type RunState } from '../run/session'
import { streamRun, streamsOutputs, UNSUPPORTED_STREAMING } from '../run/stream'
import type { EngineClient } from '../engine/client'
import type { ChainSummary, LayoutModel, PanelState } from '../engine/types'

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

export const MISSING_NOTE = (linkpath: string): string => `${linkpath} is no longer in the vault, so it was skipped.`

export const ALREADY_RUNNING = 'This chain node is already running.'

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

    const seed = await this.seed(reading.inputs.inputs, reading.drawing)
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
      this.deps.notify(error instanceof Error ? error.message : 'Could not reach that drawing')
    }
    return undefined
  }

  /** The inputs as one piece of text; a note contributes its body, minus frontmatter. */
  private async seed(inputs: NodeInput[], drawing: string): Promise<string> {
    const parts: string[] = []
    for (const input of inputs) {
      if (input.kind === 'text') {
        parts.push(input.text)
        continue
      }
      const note = this.deps.app.metadataCache.getFirstLinkpathDest(input.linkpath, drawing)
      if (!(note instanceof TFile)) {
        this.deps.notify(MISSING_NOTE(input.linkpath))
        continue
      }
      parts.push(seedFromNote(await this.deps.app.vault.cachedRead(note)))
    }
    return joinSeed(parts)
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

    let live: LiveOutputs | undefined

    const outcome = await streamRun({
      engine: this.deps.engine,
      request: {
        chainName: chain.name,
        seedPrompt: seed,
        ...(parameterValue ? { paramValue: parameterValue } : {}),
      },
      signal: controller.signal,
      onState: async state => {
        await say(progress(state.layout))
        const layout = buildRunPanels(chain, state.layout, state.nodes)
        live ??= await this.open(state.runId, layout, plan)
        if (live) await this.fill(live, layout, false)
      },
      notify: this.deps.notify,
      markOffline: this.deps.markOffline,
    })
    // Dropped by an unload: the notes stay as a record of a real run.
    if (outcome.aborted) return

    await this.finish(settleRun(outcome.state, outcome.failure), plan, outcome.failure, live)
  }

  /**
   * One empty note per declared output, placed in the frame. Once, on the first
   * frame that names the panels: placement is initial only, so an output the
   * reader drags somewhere better stays there.
   */
  private async open(
    runId: string | undefined,
    layout: RunLayout,
    plan: NodeRunPlan,
  ): Promise<LiveOutputs | undefined> {
    if (!runId || layout.panels.length === 0) return undefined

    const frame = buildRunFrame({ layout, chainName: plan.chain.name, runId, node: plan.node })
    const outputs: LiveOutput[] = []
    const placed: PlacedOutput[] = []
    for (const one of frame.panels) {
      const note = await this.deps.notes.open(one.panel, { runId, chainName: plan.chain.name })
      // A refused note has said so already; the rest of the run still lands.
      if (!note) continue
      outputs.push({ index: one.index, note, written: { text: '', state: 'pending' } })
      placed.push({ placed: one, note: note.file })
    }

    await this.place(frame, placed, plan.view)
    return { frame, outputs }
  }

  /** Writes each output into its note. `force` is a settled run's last flush. */
  private async fill(live: LiveOutputs, layout: RunLayout, force: boolean): Promise<void> {
    for (const output of live.outputs) {
      // By index, never by place in the frame: `columns` reorders.
      const panel = layout.panels[output.index]
      if (!panel) continue
      const shown = { ...panel, text: shownText(panel) }
      if (!force && !worthWriting(output.written, shown)) continue
      output.written = { text: shown.text, state: shown.state }
      await output.note.write(shown)
    }
  }

  /**
   * The outputs take their final text and the node says how it went. A run that
   * produced no panels is done, not failed — an empty answer is still an answer.
   */
  private async finish(
    state: RunState,
    plan: NodeRunPlan,
    /** Already said on the way out, so a failure is not said twice. */
    said: string | undefined,
    live: LiveOutputs | undefined,
  ): Promise<void> {
    const { chain, target, view } = plan
    const error = runFailure(state)
    if (error && error !== said) this.deps.notify(error)
    // The reason goes onto the node too: a notice is gone when the reader looks back.
    const outcome: NodeRunStatus = error ? { kind: 'failed', error } : { kind: 'done' }

    if (!live) {
      if (!state.runId) {
        if (!error) this.deps.notify(NOTHING_WRITTEN)
        await this.onDrawing(() =>
          this.deps.surface.setRunStatus(target, { kind: 'failed', ...(error ? { error } : {}) }, view),
        )
        return
      }
      this.deps.notify(NO_OUTPUTS)
      await this.onDrawing(() => this.deps.surface.setRunStatus(target, outcome, view))
      return
    }

    // A failed run's last frame carries the outcome, so nothing is settled here (ADR-0003).
    await this.fill(live, buildRunPanels(chain, state.layout, state.nodes), true)
    await this.onDrawing(() => this.deps.surface.setRunStatus(target, outcome, view))
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
    try {
      if (!(await action())) this.deps.notify(NODE_GONE)
    } catch (error) {
      this.deps.notify(error instanceof Error ? error.message : 'Could not reach that drawing')
    }
  }
}

/** One output being filled: the note, and which panel's words go in it. */
interface LiveOutput {
  /** Its panel's position in the engine's order. */
  index: number
  note: OpenOutputNote
  /** What it was last written from, which sets the flush cadence. */
  written: { text: string; state: PanelState }
}

interface LiveOutputs {
  frame: RunFrame
  /** Only the outputs that got a note. */
  outputs: LiveOutput[]
}

/** A panel's settled text, or the tokens so far. */
function shownText(panel: RunPanel): string {
  return panel.streaming ?? panel.text
}

/**
 * A line at a time, the spike's cadence (`docs/spike-ea.md`, Q2): an embeddable
 * repaints per write, so a write per token buys nothing. A hop's unfinished last
 * line is flushed by the state change when it settles.
 */
function worthWriting(before: { text: string; state: PanelState }, panel: RunPanel): boolean {
  if (before.state !== panel.state) return true
  return finishedLines(panel.text) > finishedLines(before.text)
}

/** The line still being written is not a finished one. */
function finishedLines(text: string): number {
  return text.trimEnd().split('\n').length - 1
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
