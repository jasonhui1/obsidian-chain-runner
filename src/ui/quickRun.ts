import { MarkdownView, type App } from 'obsidian'
import { ChainPicker, ParameterPicker } from './chainPicker'
import type { RunResultView } from './resultView'
import { buildRunResult, emptyRunState, settleRun } from '../run/session'
import { streamRun, streamsLayout, UNSUPPORTED_ENGINE } from '../run/stream'
import { chooseSeed, type Seed, type SeedSource } from '../run/seed'
import type { EngineClient } from '../engine/client'
import { parameterToAsk, type ChainSummary } from '../engine/types'

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
  /** Writes the hold note of a run that reached a hold. */
  holdReached: (runId: string, nodeId: string) => Promise<void>
}

/** One run, as the reader assembled it: what to run, on what, with what set. */
interface QuickRun {
  chain: ChainSummary
  /** The words the engine is given, and how much of the note they are. */
  seed: Seed
  /** The note behind those words, which the header names and links resolve against. */
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
    const editing = this.deps.app.workspace.getActiveViewOfType(MarkdownView)
    // The note and the selection come from one view, never two.
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
      // A whitespace-only selection is no selection, so this is always an empty note.
      this.deps.notify('This note is empty')
      return
    }

    await this.runOn(seed, { name: note.name, path: note.path })
  }

  /**
   * A run on words already chosen — the note the command read, or the lines a
   * reader kept off one. The picker, then the run.
   */
  async runOn(seed: Seed, source: SeedSource): Promise<void> {
    const workspace = await this.deps.withEngine(() => this.deps.engine.loadWorkspace())
    if (!workspace) return
    // The panels are the engine's to project (ADR-0001), so an engine too old to
    // stream them is refused rather than drawn for from a stale rule.
    if (!streamsLayout(workspace.capabilities)) {
      this.deps.notify(UNSUPPORTED_ENGINE)
      return
    }
    if (workspace.chains.length === 0) {
      this.deps.notify('No chains in the workspace')
      return
    }

    new ChainPicker(this.deps.app, workspace.chains, chain =>
      this.pickParameter({ chain, seed, source }),
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
      request: { chainName: chain.name, seedPrompt: seed.text, ...(paramValue ? { paramValue } : {}) },
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
}
