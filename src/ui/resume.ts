import { normalizePath, TFile, type App } from 'obsidian'
import { ensureFolder, guardWrite, readIfPresent } from './vaultWrite'
import { appendCanon, CANON_PATH, tickedCanonLines } from '../run/canon'
import { appendResumeLink, directionBlock, holdHeading, waitingHoldsIn } from '../run/holdNote'
import { runViewUrl } from '../run/provenance'
import { resumeRequest, runResume } from '../run/resume'
import type { EngineClient } from '../engine/client'

/**
 * The "Resume" command: a hold's answer posted back to the run it came from.
 * The call itself is `src/run/resume.ts`; this is the vault half — reading the
 * note and canon, and writing back what the continued run produced.
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
  /** The run it carried on as. */
  runId?: string
  /** The engine forked rather than carrying the run on: `runId` is a new run (#53). */
  forked: boolean
  error?: string
  canon: CanonOutcome
}

export interface ResumeDeps {
  app: App
  engine: EngineClient
  withEngine: <T>(action: () => Promise<T>) => Promise<T | undefined>
  notify: (message: string) => void
  engineUrl: () => string
  /** Brings the run's hold note up to date with what the engine now holds. */
  refresh: (runId: string) => Promise<unknown>
  /** Shows the fork's own hold note, written first when the fork has none yet. */
  openFork: (runId: string) => Promise<unknown>
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
   * The note's hold answered, its ticks locked and the run linked back.
   * `undefined` only when nothing ran, which says why in a notice of its own.
   */
  async resumeNote(file: TFile): Promise<ResumeResult | undefined> {
    const content = await this.deps.app.vault.cachedRead(file)
    const heading = holdHeading(content)
    const direction = directionBlock(content)
    if (!heading || direction === undefined) {
      this.deps.notify(NOT_A_HOLD_NOTE)
      return undefined
    }

    const canonPath = normalizePath(CANON_PATH)
    const canon = await readIfPresent(this.deps.app, canonPath)
    const request = resumeRequest({ direction, holds: waitingHoldsIn(content), ...(canon !== undefined ? { canon } : {}) })

    const { engine } = this.deps
    const resumed = await this.deps.withEngine(async () => {
      const { capabilities } = await engine.loadWorkspace()
      return runResume(engine, capabilities, heading.runId, request)
    })
    if (!resumed) return undefined
    if (resumed.kind === 'refused') {
      this.deps.notify(resumed.said)
      return undefined
    }

    const outcome = resumed.outcome
    const forked = resumed.forked
    const ticked = tickedCanonLines(direction)
    if (!outcome.runId) return { forked, ...(outcome.error ? { error: outcome.error } : {}), canon: ticked.length > 0 ? 'held-back' : 'none' }

    const canonOutcome = await this.lockCanon(canonPath, ticked, outcome.error)
    // A note that refuses the link says so on its own; the run still happened, so it is still reported.
    await this.linkRun(file, content, { runId: outcome.runId, forked })
    // A fork has moved the engine on whether it landed or not; a run carried on
    // in place that failed is left as it stands, still showing its own hold.
    if (forked) await this.followFork(heading.runId, outcome.runId)
    else if (!outcome.error) await this.deps.refresh(outcome.runId)

    return {
      runId: outcome.runId,
      forked,
      ...(outcome.error ? { error: outcome.error } : {}),
      canon: canonOutcome,
    }
  }

  /**
   * The fork shown — it is a run of its own — and the note it forked from
   * brought up to date, so it stops offering a hold the engine has answered.
   */
  private async followFork(from: string, runId: string): Promise<void> {
    await this.deps.openFork(runId)
    await this.deps.refresh(from)
  }

  /** The ticks locked into canon, held back when the run failed (#32), or none to lock. */
  private async lockCanon(path: string, ticked: string[], error: string | undefined): Promise<CanonOutcome> {
    if (ticked.length === 0) return 'none'
    if (error) return 'held-back'
    return (await this.writeCanon(path, ticked)) ? 'written' : 'held-back'
  }

  private resumeNotice(result: ResumeResult): string {
    if (!result.runId) return result.error ? `Resume failed: ${result.error}` : 'Resume produced no run'
    const as = result.forked ? `Resumed — forked as run ${result.runId}` : `Resumed as run ${result.runId}`
    if (!result.error) return as
    const note = canonNote(result.canon)
    return `${as}, but it failed: ${result.error}${note ? ` (${note})` : ''}`
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

  private async linkRun(file: TFile, content: string, run: { runId: string; forked: boolean }): Promise<void> {
    await guardWrite(this.deps.notify, 'the hold note', async () => {
      const url = runViewUrl(this.deps.engineUrl(), run.runId)
      await this.deps.app.vault.modify(file, appendResumeLink(content, { ...run, ...(url ? { url } : {}) }))
    })
  }
}
