import { MarkdownView, TFile, type App } from 'obsidian'
import { ChainPicker, ParameterPicker } from './chainPicker'
import type { RunResultView } from './resultView'
import { engineFailureMessage } from '../engine/guard'
import { EngineOfflineError, RequestAbortedError } from '../engine/transport'
import { applyRunEvent, buildRunResult, emptyRunState, settleRun } from '../run/session'
import { seedFromNote } from '../run/seed'
import type { EngineClient } from '../engine/client'
import type { ChainSummary } from '../engine/types'

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
  /** The note's text, or the selection when there was one. */
  seed: string
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
    const note = this.deps.app.workspace.getActiveFile()
    if (!note || note.extension !== 'md') {
      this.deps.notify('Open a note to run a chain on it')
      return
    }
    const seed = await this.seedFrom(note)
    if (seed === '') {
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

  /** The selection when there is one, so a passage can be run without splitting the note. */
  private async seedFrom(note: TFile): Promise<string> {
    const editor = this.deps.app.workspace.getActiveViewOfType(MarkdownView)?.editor
    const selection = editor?.getSelection() ?? ''
    if (selection.trim() !== '') return selection.trim()
    return seedFromNote(await this.deps.app.vault.cachedRead(note))
  }

  /**
   * A chain that declares a dropdown reads it as an input, so it is asked for
   * before the run rather than left empty — an unanswered parameter runs a
   * different chain than the reader picked.
   */
  private pickParameter(run: QuickRun): void {
    const parameter = run.chain.parameter
    if (!parameter || parameter.options.length === 0) {
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
    const show = (): void => view.show(buildRunResult({ chain, seedSource: note.name, state, paramValue }), note.path)
    show()

    let failure: string | undefined
    try {
      const request = { chainName: chain.name, seedPrompt: seed, ...(paramValue ? { paramValue } : {}) }
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
