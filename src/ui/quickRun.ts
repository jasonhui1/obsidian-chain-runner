import { MarkdownView, TFile, type App } from 'obsidian'
import { ChainPicker, ParameterPicker } from './chainPicker'
import type { RunResultView } from './resultView'
import { engineFailureMessage } from '../engine/guard'
import { EngineOfflineError, RequestAbortedError } from '../engine/transport'
import { applyRunEvent, buildRunResult, emptyRunState, settleRun } from '../run/session'
import { chooseSeed, type Seed } from '../run/seed'
import type { EngineClient } from '../engine/client'
import { parameterToAsk, type ChainSummary } from '../engine/types'

/**
 * Said when the engine does not stream layout frames. Named as the thing that is
 * missing rather than as a failure, because the fix is on the engine's side.
 */
export const UNSUPPORTED_ENGINE =
  'This engine is too old for Chain Runner: it does not stream layout frames. Update maestro-playground.'

export interface QuickRunDeps {
  app: App
  engine: EngineClient
  /** Every call that needs the engine goes through this; offline is a notice and nothing else. */
  withEngine: <T>(action: () => Promise<T>) => Promise<T | undefined>
  /** Opens or reveals the result view; `undefined` when the workspace has no room. */
  openResultView: () => Promise<RunResultView | undefined>
  notify: (message: string) => void
  /** Moves the status pill offline on first-hand evidence, rather than at the next poll. */
  markOffline: () => void
}

/** One run, as the reader assembled it: what to run, on what, with what set. */
interface QuickRun {
  chain: ChainSummary
  /** The note's text, or the selection when there was one, and which of the two. */
  seed: Seed
  note: TFile
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
    const editing = this.deps.app.workspace.getActiveViewOfType(MarkdownView)
    // The note and the selection come from one view, never two. A selection left
    // in another pane is not part of the note in front of you, and taking the
    // text from one and the name from the other would run one note under the
    // other's header.
    const note = editing?.file ?? this.deps.app.workspace.getActiveFile()
    if (!note || note.extension !== 'md') {
      this.deps.notify('Open a note to run a chain on it')
      return
    }
    const seed = chooseSeed({
      selection: editing?.editor.getSelection(),
      noteText: await this.deps.app.vault.cachedRead(note),
    })
    if (seed.text === '') {
      // A selection that is only whitespace is no selection at all, so an empty
      // seed here is always an empty note.
      this.deps.notify('This note is empty')
      return
    }

    const workspace = await this.deps.withEngine(() => this.deps.engine.loadWorkspace())
    if (!workspace) return
    // The panels are the engine's to project (ADR-0017). An engine too old to
    // stream them cannot be drawn for, and saying so is the whole point of
    // feature-detecting: the alternative is a view quietly showing a stale rule.
    if (!workspace.capabilities.runLayoutFrames) {
      this.deps.notify(UNSUPPORTED_ENGINE)
      return
    }
    if (workspace.chains.length === 0) {
      this.deps.notify('No chains in the workspace')
      return
    }

    new ChainPicker(this.deps.app, workspace.chains, chain =>
      this.pickParameter({ chain, seed, note }),
    ).open()
  }

  /** Drops the run in flight — the plugin is unloading, or a new run replaced it. */
  stop(): void {
    this.inFlight?.abort()
    this.inFlight = undefined
  }

  /** Asks for the chain's dropdown when it has one to ask for; launches when it does not. */
  private pickParameter(run: QuickRun): void {
    const parameter = parameterToAsk(run.chain)
    if (!parameter) {
      void this.launch(run)
      return
    }
    new ParameterPicker(this.deps.app, parameter.name, parameter.options, paramValue => {
      void this.launch({ ...run, paramValue })
    }).open()
  }

  private async launch(run: QuickRun): Promise<void> {
    const { chain, seed, note, paramValue } = run
    const view = await this.deps.openResultView()
    if (!view) {
      this.deps.notify('No room in the sidebar for the result')
      return
    }

    this.stop()
    const controller = new AbortController()
    this.inFlight = controller

    let state = emptyRunState()
    // The header names the note and how much of it was read; the seed's own text
    // has gone to the engine by then and is not the view's to hold.
    const show = (): void =>
      view.show(
        buildRunResult({ chain, seed: { note: note.name, from: seed.from }, state, paramValue }),
        note.path,
      )
    show()

    let failure: string | undefined
    try {
      const request = { chainName: chain.name, seedPrompt: seed.text, ...(paramValue ? { paramValue } : {}) }
      for await (const event of this.deps.engine.launchRun(request, controller.signal)) {
        state = applyRunEvent(state, event)
        show()
      }
    } catch (error) {
      // A superseded run leaves the view to the run that replaced it.
      if (error instanceof RequestAbortedError) return
      failure = engineFailureMessage(error)
      if (failure === undefined) throw error
      if (error instanceof EngineOfflineError) this.deps.markOffline()
      this.deps.notify(failure)
    } finally {
      if (this.inFlight === controller) {
        this.inFlight = undefined
        state = settleRun(state, failure)
        show()
      }
    }
  }
}
