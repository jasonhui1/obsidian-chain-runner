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
 * Running a chain node: the arrows into it become the seed, and what comes back
 * becomes notes on the drawing.
 *
 * The three decisions this makes are each somewhere else, and pure: what is
 * bound in is `./nodeScene.ts`, what a panel *is* is the engine's (ADR-0001),
 * and where each one lands is `../run/runFrame.ts`. What is left here is the
 * order — what is checked before anything is launched, what the node says while
 * it runs, and what is written when it settles.
 *
 * The outputs fill in place. The engine names the run before its first hop, so
 * every declared output is opened as an empty note and placed on the drawing as
 * soon as the first layout frame says what they are; each one is then rewritten
 * as its hop writes, and the reader watches the drawing fill (ADR-0003).
 */

export const NO_INPUTS =
  'Nothing is bound into this chain node. Draw an arrow into it from a text block or an embedded note.'

/** Said when arrows were drawn into the node that say nothing, alongside ones that do. */
export const SOME_UNBOUND = (count: number): string =>
  count === 1
    ? 'One arrow into this node came from nothing readable, and was skipped.'
    : `${count} arrows into this node came from nothing readable, and were skipped.`

/** A note an embeddable points at that the vault no longer holds. */
export const MISSING_NOTE = (linkpath: string): string => `${linkpath} is no longer in the vault, so it was skipped.`

/** Said on a second click while the first run is still going. */
export const ALREADY_RUNNING = 'This chain node is already running.'

/** The run reached the engine and never got an id, so there is nothing to file under. */
export const NOTHING_WRITTEN = 'The run did not finish, so nothing was written.'

/** The run finished and the chain produced no panels; there is nothing to place. */
export const NO_OUTPUTS = 'The run finished without producing any output.'

/** This Excalidraw cannot make a frame, so the outputs were placed without one. */
export const NO_FRAME =
  'This Excalidraw cannot make frames, so the outputs were placed loose beside the node. Update it to group them.'

export interface NodeRunDeps {
  app: App
  engine: EngineClient
  /** Every call that needs the engine goes through this; offline is a notice and nothing else. */
  withEngine: <T>(action: () => Promise<T>) => Promise<T | undefined>
  notify: (message: string) => void
  /** Moves the status pill offline on first-hand evidence, rather than at the next poll. */
  markOffline: () => void
  surface: NodeSurface
  /** The output-note convention, shared with the result view's own actions. */
  notes: OutputNotes
}

/** One run of one node, as the click assembled it. */
interface NodeRunPlan {
  chain: ChainSummary
  /** What the arrows into the node came to, as one piece of text. */
  seed: string
  target: NodeTarget
  /** The view the click happened in, which is the only handle on an embedded drawing. */
  view: DrawingView | undefined
  /** Where the node sits, which is what the run's frame is placed against. */
  node: Box
  parameterValue?: string
}

export class NodeRun {
  /** One run per node. A node's second click while it runs is not a second run. */
  private readonly inFlight = new Map<string, AbortController>()

  constructor(private readonly deps: NodeRunDeps) {}

  /**
   * A click on a node's `▶ Run`.
   *
   * Everything that could stop the run is checked before the node is marked as
   * running: a reader whose engine is offline or whose arrows are bound to
   * nothing should see a notice and a node that still says `▶ Run`.
   */
  async run(data: ChainNodeData, element: MaybeNodeElement, view?: DrawingView): Promise<void> {
    const target: NodeTarget = {
      nodeId: data.nodeId,
      ...(element.groupIds ? { groupIds: element.groupIds } : {}),
    }
    if (this.inFlight.has(data.nodeId)) {
      this.deps.notify(ALREADY_RUNNING)
      return
    }
    // Claimed before the first await, not when the stream opens: the checks below
    // reach the engine, and a second click during one of them is still a second
    // run on a node that is already starting one.
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
    // The panels are the engine's to project (ADR-0001) and the frame is placed
    // from them, so an engine that does not stream them cannot be drawn for —
    // and one that cannot name a run up front cannot have its outputs filled in
    // place (ADR-0003).
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
    // A chain that pins its own files reads nothing from the drawing, so an
    // empty seed is only a mistake for a chain that asked for one.
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

  /**
   * The inputs as one piece of text. A note contributes its body — the vault's
   * own frontmatter is bookkeeping and not part of the argument, the same rule
   * the quick path reads a note by.
   */
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
    // The node is written to only when its words change: every write to a
    // drawing is a save, and a run of forty tokens is not forty saves.
    const say = async (status: NodeRunStatus): Promise<void> => {
      const next = JSON.stringify(status)
      if (next === said) return
      said = next
      await this.onDrawing(() => this.deps.surface.setRunStatus(target, status, view))
    }

    await say({ kind: 'running', done: 0 })

    /** The outputs on the drawing, from the first layout frame that names them. */
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
    // A run dropped because the plugin unloaded has no node left to tell. The
    // notes it opened stay as they are: they are a real record of a real run.
    if (outcome.aborted) return

    await this.finish(settleRun(outcome.state, outcome.failure), plan, outcome.failure, live)
  }

  /**
   * Opens the run's outputs and puts them on the drawing: one empty note per
   * declared output, each inside the frame, before any of them has anything to
   * say.
   *
   * This happens once, on the first frame that names the panels. Later frames
   * change what the panels hold and never where they are — placement is initial
   * only, and a reader who has dragged an output somewhere better keeps it.
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
      // A note the vault refused has said so already; the rest of the run still
      // lands, so one unwritable name does not cost the reader the whole frame.
      if (!note) continue
      outputs.push({ index: one.index, note, written: { text: '', state: 'pending' } })
      placed.push({ placed: one, note: note.file })
    }

    await this.place(frame, placed, plan.view)
    return { frame, outputs }
  }

  /**
   * Writes what each output says now into the note showing it.
   *
   * Not every frame: the spike found an embeddable repaints per write and not
   * per character (`docs/spike-ea.md`, Q2), so the cadence that costs least and
   * shows the same thing is a line at a time. `force` is the last flush of a
   * settled run, where every note takes the panel's final word whatever it is.
   */
  private async fill(live: LiveOutputs, layout: RunLayout, force: boolean): Promise<void> {
    for (const output of live.outputs) {
      // The frame's order is not the engine's, so the panel is found by the index
      // it was opened against and never by where it sits in the frame.
      const panel = layout.panels[output.index]
      if (!panel) continue
      const shown = { ...panel, text: shownText(panel) }
      if (!force && !worthWriting(output.written, shown)) continue
      output.written = { text: shown.text, state: shown.state }
      await output.note.write(shown)
    }
  }

  /**
   * The run is over: the outputs take their final text, and the node says how it
   * went.
   *
   * A run that never reported an id opened nothing, so there is nothing to
   * finish and nothing was written. A run that finished having produced no
   * panels is done, not failed: an empty answer is still the chain's answer.
   */
  private async finish(
    state: RunState,
    plan: NodeRunPlan,
    /** What was already said on the way out, so a failure is not said twice. */
    said: string | undefined,
    live: LiveOutputs | undefined,
  ): Promise<void> {
    const { chain, target, view } = plan
    const error = runFailure(state)
    // A hop that failed is the engine's own message, and nothing has said it yet.
    if (error && error !== said) this.deps.notify(error)
    // The reason travels onto the node itself: a notice is gone by the time the
    // reader looks back at the drawing, and the node is what they look at.
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

    // The engine sends one last frame when a run fails, every panel still
    // pending moved to `errored` with its message (ADR-0003) — so this writes
    // the outcome the engine settled, and never one worked out here.
    await this.fill(live, buildRunPanels(chain, state.layout, state.nodes), true)
    await this.onDrawing(() => this.deps.surface.setRunStatus(target, outcome, view))
  }

  /** Puts the frame on the drawing, saying so when it could not be a real frame. */
  private async place(frame: RunFrame, outputs: PlacedOutput[], view: DrawingView | undefined): Promise<void> {
    await this.onDrawing(async () => {
      // The outputs are the run; a frame that could not be made is worth saying
      // and not worth withholding them over.
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
  /** Which of the layout's panels this note holds, in the engine's own order. */
  index: number
  note: OpenOutputNote
  /** What the note was last written from, which is what sets the flush cadence. */
  written: { text: string; state: PanelState }
}

/** A run's outputs on the drawing, once the first layout frame has named them. */
interface LiveOutputs {
  frame: RunFrame
  /** Only the outputs that got a note; one the vault refused is simply absent. */
  outputs: LiveOutput[]
}

/** What a panel has to show right now: its settled text, or the tokens so far. */
function shownText(panel: RunPanel): string {
  return panel.streaming ?? panel.text
}

/**
 * Whether a panel has moved on enough to be worth a vault write — it has
 * finished another line, or its outcome changed.
 *
 * The spike's cadence, taken literally (`docs/spike-ea.md`, Q2): an embeddable
 * repaints per write and not per character, so a write per token would be a
 * vault write per character and would show the reader nothing that a line at a
 * time does not. A hop's last, unfinished line is never lost — the change of
 * state when it settles flushes whatever it ended on.
 */
function worthWriting(before: { text: string; state: PanelState }, panel: RunPanel): boolean {
  if (before.state !== panel.state) return true
  return finishedLines(panel.text) > finishedLines(before.text)
}

/** Lines the text has actually ended. The one still being written is not one. */
function finishedLines(text: string): number {
  return text.trimEnd().split('\n').length - 1
}

/**
 * What the node says while a run is going: panels landed, out of panels declared.
 *
 * The count comes from the engine's own layout frame, which arrives before the
 * first hop — so a node counts steps as soon as there is a total to count
 * against, and says only that it is running before then.
 */
function progress(model: LayoutModel | undefined): NodeRunStatus {
  if (!model || model.panels.length === 0) return { kind: 'running', done: 0 }
  return {
    kind: 'running',
    done: model.panels.filter(panel => panel.state !== 'pending').length,
    total: model.panels.length,
  }
}
