import { normalizePath, TFile, type App } from 'obsidian'
import { ensureFolder, guardWrite, readIfPresent } from './vaultWrite'
import { appendCanon, CANON_PATH, tickedCanonLines } from '../run/canon'
import { appendResumeLink, directionBlock } from '../run/holdNote'
import { runViewUrl } from '../run/provenance'
import { greenlightPitch, runResume } from '../run/resume'
import type { EngineClient } from '../engine/client'

/**
 * The "Resume" command: a hold note's Direction block, run as
 * `develop-direction`. The run itself is `src/run/resume.ts`; this is the
 * vault half — reading the note and canon, and writing back what the run
 * produced.
 */

export const NOT_A_HOLD_NOTE = 'Open a hold note to resume it'

/** What became of the hold's ticked CANON? lines (#32: they land only on a run that succeeded). */
export type CanonOutcome = 'written' | 'held-back' | 'none'

/** How the panel and the command both name what became of the ticks; empty when there were none. */
export function canonNote(canon: CanonOutcome): string {
  if (canon === 'none') return ''
  return canon === 'written' ? 'canon written' : 'canon not written'
}

/** What a resume landed on, for the command and the directing panel alike. */
export interface ResumeResult {
  /** The run it landed on; absent when the engine never named one. */
  runId?: string
  /** The Greenlight Pitch the run produced; absent when it failed or pitched nothing. */
  pitch?: string
  error?: string
  canon: CanonOutcome
}

export interface ResumeDeps {
  app: App
  engine: EngineClient
  withEngine: <T>(action: () => Promise<T>) => Promise<T | undefined>
  notify: (message: string) => void
  engineUrl: () => string
}

export class Resume {
  constructor(private readonly deps: ResumeDeps) {}

  async start(): Promise<void> {
    const file = this.deps.app.workspace.getActiveFile()
    if (!file || file.extension !== 'md') {
      this.deps.notify(NOT_A_HOLD_NOTE)
      return
    }
    const result = await this.resumeNote(file)
    if (result) this.deps.notify(this.resumeNotice(result))
  }

  /**
   * The note's Direction run, its ticks locked and the run linked back.
   * `undefined` only when nothing ran, which says why in a notice of its own.
   */
  async resumeNote(file: TFile): Promise<ResumeResult | undefined> {
    const content = await this.deps.app.vault.cachedRead(file)
    const direction = directionBlock(content)
    if (direction === undefined) {
      this.deps.notify(NOT_A_HOLD_NOTE)
      return undefined
    }

    const canonPath = normalizePath(CANON_PATH)
    const canon = await readIfPresent(this.deps.app, canonPath)

    const outcome = await this.deps.withEngine(() => runResume(this.deps.engine, direction, canon))
    if (!outcome) return undefined

    const ticked = tickedCanonLines(direction)
    if (!outcome.runId) return { ...(outcome.error ? { error: outcome.error } : {}), canon: ticked.length > 0 ? 'held-back' : 'none' }

    const canonOutcome = await this.lockCanon(canonPath, ticked, outcome.error)
    // A note that refuses the link says so on its own; the run still happened, so it is still reported.
    await this.linkRun(file, content, outcome.runId)

    return {
      runId: outcome.runId,
      ...(outcome.error ? { error: outcome.error } : {}),
      ...(outcome.error ? {} : await this.pitch(outcome.runId)),
      canon: canonOutcome,
    }
  }

  /** The ticks locked into canon, held back when the run failed (#32), or none to lock. */
  private async lockCanon(path: string, ticked: string[], error: string | undefined): Promise<CanonOutcome> {
    if (ticked.length === 0) return 'none'
    if (error) return 'held-back'
    return (await this.writeCanon(path, ticked)) ? 'written' : 'held-back'
  }

  /** The pitch the run landed on, when the engine can still be asked for it. */
  private async pitch(runId: string): Promise<{ pitch?: string }> {
    const landed = await this.deps.withEngine(() => this.deps.engine.getRun(runId))
    const pitch = landed && greenlightPitch(landed.agentOutputs)
    return pitch ? { pitch } : {}
  }

  private resumeNotice(result: ResumeResult): string {
    if (!result.runId) return result.error ? `Resume failed: ${result.error}` : 'Resume produced no run'
    if (!result.error) return `Resumed as run ${result.runId}`
    const note = canonNote(result.canon)
    return `Resumed as run ${result.runId}, but it failed: ${result.error}${note ? ` (${note})` : ''}`
  }

  /** Reads canon again right before writing — not the snapshot sent with the run — so a change made while the run was going is never clobbered. */
  private async writeCanon(path: string, lines: string[]): Promise<boolean> {
    const wrote = await guardWrite(this.deps.notify, 'the canon file', async () => {
      await ensureFolder(this.deps.app, path.slice(0, path.lastIndexOf('/')))
      const current = this.deps.app.vault.getAbstractFileByPath(path)
      const fresh = appendCanon(current instanceof TFile ? await this.deps.app.vault.cachedRead(current) : undefined, lines)
      if (current instanceof TFile) await this.deps.app.vault.modify(current, fresh)
      else await this.deps.app.vault.create(path, fresh)
      return true
    })
    return wrote === true
  }

  private async linkRun(file: TFile, content: string, runId: string): Promise<void> {
    await guardWrite(this.deps.notify, 'the hold note', async () => {
      const url = runViewUrl(this.deps.engineUrl(), runId)
      await this.deps.app.vault.modify(file, appendResumeLink(content, { runId, ...(url ? { url } : {}) }))
    })
  }
}
