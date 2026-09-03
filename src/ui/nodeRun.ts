import { TFile, type App } from 'obsidian'
import type { ChainNodeData, MaybeNodeElement, NodeRunStatus, NodeTarget } from './chainNode'
import type { DrawingView, NodeReading, NodeSurface, PlacedOutput } from './excalidraw'
import type { Box, NodeInput } from './nodeScene'
import type { OutputNotes } from './outputNotes'
import { CHAIN_GONE, NODE_GONE } from './chainNodes'
import { buildRunPanels } from '../run/panels'
import { buildRunFrame, type RunFrame } from '../run/runFrame'
import { joinSeed, seedFromNote } from '../run/seed'
import { runFailure, settleRun, type RunState } from '../run/session'
import { streamRun, streamsLayout, UNSUPPORTED_ENGINE } from '../run/stream'
import type { EngineClient } from '../engine/client'
import type { ChainSummary, LayoutModel } from '../engine/types'

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
 * Nothing is written before the run finishes. The output-note convention names a
 * run's folder after its id, and the engine reports that id when the run
 * completes — so there is no note to stream into until there is (ADR-0002).
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
    // The panels are the engine's to project (ADR-0001), and the frame is placed
    // from them; an engine that does not stream them cannot be drawn for.
    if (!streamsLayout(workspace.capabilities)) {
      this.deps.notify(UNSUPPORTED_ENGINE)
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

    const outcome = await streamRun({
      engine: this.deps.engine,
      request: {
        chainName: chain.name,
        seedPrompt: seed,
        ...(parameterValue ? { paramValue: parameterValue } : {}),
      },
      signal: controller.signal,
      onState: state => say(progress(state.layout)),
      notify: this.deps.notify,
      markOffline: this.deps.markOffline,
    })
    // A run dropped because the plugin unloaded has no node left to tell.
    if (outcome.aborted) return

    await this.settle(settleRun(outcome.state, outcome.failure), plan, outcome.failure)
  }

  /**
   * What a finished run leaves behind: the outputs as notes, in a frame beside
   * the node, and the node saying how it went.
   *
   * A run that never reported an id wrote nothing — its notes have nowhere to be
   * filed (ADR-0002) — and says so rather than leaving an empty frame. A run
   * that finished and produced nothing is done, not failed: an empty answer is
   * still the chain's answer.
   */
  private async settle(
    state: RunState,
    plan: NodeRunPlan,
    /** What was already said on the way out, so a failure is not said twice. */
    said: string | undefined,
  ): Promise<void> {
    const { chain, target, view, node } = plan
    const error = runFailure(state)
    // A hop that failed is the engine's own message, and nothing has said it yet.
    if (error && error !== said) this.deps.notify(error)
    // The reason travels onto the node itself: a notice is gone by the time the
    // reader looks back at the drawing, and the node is what they look at.
    const outcome: NodeRunStatus = error ? { kind: 'failed', error } : { kind: 'done' }

    if (!state.runId) {
      if (!error) this.deps.notify(NOTHING_WRITTEN)
      await this.onDrawing(() => this.deps.surface.setRunStatus(target, { kind: 'failed', ...(error ? { error } : {}) }, view))
      return
    }

    const layout = buildRunPanels(chain, state.layout, state.nodes)
    if (layout.panels.length === 0) {
      this.deps.notify(NO_OUTPUTS)
      await this.onDrawing(() => this.deps.surface.setRunStatus(target, outcome, view))
      return
    }

    const frame = buildRunFrame({ layout, chainName: chain.name, runId: state.runId, node })
    const outputs: PlacedOutput[] = []
    for (const placed of frame.panels) {
      const note = await this.deps.notes.write(placed.panel, { runId: state.runId, chainName: chain.name })
      // A note the vault refused has said so already; the rest of the run still
      // lands, so one unwritable name does not cost the reader the whole frame.
      if (note) outputs.push({ placed, note })
    }

    await this.place(frame, outputs, view)
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
