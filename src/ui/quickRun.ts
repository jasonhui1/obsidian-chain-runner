import type { App } from 'obsidian'
import { fileName, type NoteStore } from './noteStore'
import { ChainPicker, ParameterPicker, RunCountPicker, SeedPicker } from './chainPicker'
import type { RunResultView } from './resultView'
import { applyRunEvent, buildRunResult, emptyRunState, settleRun, type RunState } from '../run/session'
import { streamRun, streamsLayout, UNSUPPORTED_ENGINE } from '../run/stream'
import { chooseSeed, type Seed, type SeedSource } from '../run/seed'
import type { EngineClient } from '../engine/client'
import { EngineOfflineError, RequestAbortedError } from '../engine/transport'
import { engineFailureMessage } from '../engine/guard'
import { isEvent, parameterToAsk, type ChainSummary, type VarianceGroup, type VarianceMemberEvent } from '../engine/types'
import type { VarianceMemberProgress, VarianceProgress } from '../run/varianceProgress'
import type { VarianceView } from './varianceView'

export interface QuickRunDeps {
  /** For the chain and parameter pickers. */
  app: App
  store: NoteStore
  engine: EngineClient
  /** Every call that needs the engine goes through this; offline is a notice and nothing else. */
  withEngine: <T>(action: () => Promise<T>) => Promise<T | undefined>
  /** Opens or reveals the result view; `undefined` when the workspace has no room. */
  openResultView: () => Promise<RunResultView | undefined>
  /** Opens the variance summary surface; `undefined` when the workspace has no room. */
  openVarianceView: () => Promise<VarianceView | undefined>
  notify: (message: string) => void
  /** Moves the status pill offline on first-hand evidence, rather than at the next poll. */
  markOffline: () => void
  /** Writes the hold note of a run that reached a hold. */
  holdReached: (runId: string, nodeId: string) => Promise<void>
}

/** One run, as the reader assembled it: what to run, on what, with what set. */
interface QuickRun {
  chain: ChainSummary
  /** The words the engine is given, and their origin. */
  seed: Seed
  /** The note the command started from, named in the result and used to resolve panel links. */
  source: SeedSource
  /** The chain's dropdown, when it declares one. */
  paramValue?: string
}

/**
 * The quick path: the note in front of you, a chain, and the result in the
 * sidebar. No drawing, and no second run store — the engine records the run the
 * way it records every other.
 */
export class QuickRunner {
  /** The run in flight. A second run supersedes the first rather than racing it. */
  private inFlight: AbortController | undefined

  constructor(private readonly deps: QuickRunDeps) {}

  /** The command. Everything after this is the reader picking, then the stream. */
  async start(): Promise<void> {
    const note = this.deps.store.front()
    if (!note) {
      this.deps.notify('Open a note to run a chain on it')
      return
    }
    const hint = chooseSeed({
      selection: note.selection,
      noteText: (await this.deps.store.read(note.path)) ?? '',
    })
    const seed: Seed = hint.text === '' ? { text: '', from: 'none' } : hint

    await this.runOn(seed, { name: fileName(note.path), path: note.path })
  }

  /**
   * A run on words already chosen — the note the command read, or the lines a
   * reader kept off one. The picker, then the run.
   */
  async runOn(seed: Seed, source: SeedSource): Promise<void> {
    const chains = await this.deps.withEngine(() => this.deps.engine.listChains())
    if (!chains) return
    const capabilities = await this.deps.engine.capabilities()
    // The panels are the engine's to project (ADR-0001), so an engine too old to
    // stream them is refused rather than drawn for from a stale rule.
    if (!streamsLayout(capabilities)) {
      this.deps.notify(UNSUPPORTED_ENGINE)
      return
    }
    if (chains.length === 0) {
      this.deps.notify('No chains in the workspace')
      return
    }

    const canRunVariance = capabilities.varianceGroups === true
    new ChainPicker(this.deps.app, chains, chain =>
      this.pickParameter({ chain, seed, source }, canRunVariance),
    ).open()
  }

  /** Drops the run in flight — the plugin is unloading, or a new run replaced it. */
  stop(): void {
    this.inFlight?.abort()
    this.inFlight = undefined
  }

  /** Asks for the chain's dropdown when it has one to ask for; launches when it does not. */
  private pickParameter(run: QuickRun, canRunVariance: boolean): void {
    const parameter = parameterToAsk(run.chain)
    if (!parameter) {
      this.pickSeed(run, canRunVariance)
      return
    }
    new ParameterPicker(this.deps.app, parameter.name, parameter.options, paramValue => {
      this.pickSeed({ ...run, paramValue }, canRunVariance)
    }).open()
  }

  /** Lets the reader keep their rough hint, or start empty without inventing one. */
  private pickSeed(run: QuickRun, canRunVariance: boolean): void {
    if (run.seed.text === '' || run.chain.seeded === false) {
      this.pickRunCount(run, canRunVariance)
      return
    }
    let hintLabel = 'Use the note as a rough hint'
    if (run.seed.from === 'selection') hintLabel = 'Use the selection as a rough hint'
    if (run.seed.from === 'marks') hintLabel = 'Use the marked lines as a rough hint'
    new SeedPicker(this.deps.app, hintLabel, choice => {
      const selected: QuickRun = choice === 'hint' ? run : { ...run, seed: { text: '', from: 'none' } }
      this.pickRunCount(selected, canRunVariance)
    }).open()
  }

  private pickRunCount(run: QuickRun, canRunVariance: boolean): void {
    if (!canRunVariance) {
      void this.launch(run)
      return
    }
    new RunCountPicker(this.deps.app, count => {
      if (count === 1) void this.launch(run)
      else void this.launchVariance(run, count)
    }).open()
  }

  private async launch(run: QuickRun): Promise<void> {
    const { chain, seed, source, paramValue } = run
    const view = await this.deps.openResultView()
    if (!view) {
      this.deps.notify('No room in the sidebar for the result')
      return
    }

    this.stop()
    const controller = new AbortController()
    this.inFlight = controller

    let state = emptyRunState()
    // The header names the note, not the seed text, which has gone to the engine.
    const show = (): void =>
      view.show(
        buildRunResult({ chain, seed: { note: source.name, from: seed.from }, state, paramValue }),
        source.path,
      )
    show()

    const outcome = await streamRun({
      engine: this.deps.engine,
      request: requestOf(run),
      signal: controller.signal,
      onState: next => {
        state = next
        show()
      },
      holdReached: this.deps.holdReached,
      notify: this.deps.notify,
      markOffline: this.deps.markOffline,
    })
    // A superseded run leaves the view to the run that replaced it.
    if (outcome.aborted || this.inFlight !== controller) return

    this.inFlight = undefined
    state = settleRun(outcome.state, outcome.failure)
    show()
  }

  private async launchVariance(run: QuickRun, count: number): Promise<void> {
    const view = await this.deps.openVarianceView()
    if (!view) {
      this.deps.notify('No room in the sidebar for the variance group')
      return
    }

    this.stop()
    const controller = new AbortController()
    this.inFlight = controller
    const members = new Map<number, { state: RunState; status: VarianceMemberProgress['status'] }>()
    const showProgress = (): void => {
      const progress: VarianceMemberProgress[] = Array.from({ length: count }, (_, instance) => {
        const member = members.get(instance)
        const currentNode = member?.state.nodes.started.at(-1)?.agentName
        return {
          instance,
          status: member?.status ?? 'queued',
          outputCount: member?.state.nodes.outputs.length ?? 0,
          ...(member?.state.runId ? { runId: member.state.runId } : {}),
          ...(currentNode ? { currentNode } : {}),
        }
      })
      const current: VarianceProgress = { chainName: run.chain.name, expectedRunCount: count, members: progress }
      view.showProgress(current)
    }

    showProgress()
    let groupId: string | undefined
    try {
      for await (const event of this.deps.engine.launchVariance({ ...requestOf(run), count }, controller.signal)) {
        if (event.type === 'variance_complete' && 'groupId' in event && typeof event.groupId === 'string') {
          groupId = event.groupId
          continue
        }
        const memberEvent = event as VarianceMemberEvent
        const previous = members.get(memberEvent.instance) ?? { state: emptyRunState(), status: 'queued' as const }
        previous.state = applyRunEvent(previous.state, memberEvent)
        if (isEvent(memberEvent, 'run_start') || isEvent(memberEvent, 'agent_start')) previous.status = 'running'
        if (isEvent(memberEvent, 'run_complete')) previous.status = 'complete'
        if (isEvent(memberEvent, 'run_waiting')) previous.status = 'waiting'
        if (isEvent(memberEvent, 'error')) previous.status = 'failed'
        members.set(memberEvent.instance, previous)
        showProgress()
      }

      if (controller.signal.aborted || this.inFlight !== controller) return
      if (!groupId) {
        const failure = 'The engine ended the variance run without naming its group.'
        this.deps.notify(failure)
        view.showFailure(failure)
        return
      }
      const group: VarianceGroup = await this.deps.engine.getVarianceGroup(groupId)
      if (this.inFlight === controller) view.showGroup(group)
    } catch (error) {
      if (error instanceof RequestAbortedError || controller.signal.aborted || this.inFlight !== controller) return
      const failure = engineFailureMessage(error)
      if (failure === undefined) throw error
      if (error instanceof EngineOfflineError) this.deps.markOffline()
      this.deps.notify(failure)
      view.showFailure(failure)
    } finally {
      if (this.inFlight === controller) this.inFlight = undefined
    }
  }
}

function requestOf({ chain, seed, paramValue }: QuickRun): { chainName: string; seedPrompt: string; paramValue?: string } {
  return { chainName: chain.name, seedPrompt: seed.text, ...(paramValue ? { paramValue } : {}) }
}
