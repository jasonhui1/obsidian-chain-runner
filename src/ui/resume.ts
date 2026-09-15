import { normalizePath, TFile, type App } from 'obsidian'
import { ensureFolder, guardWrite, readIfPresent } from './vaultWrite'
import { appendLockedCanon, CANON_PATH, tickedCanonLines } from '../run/canon'
import { appendResumeLink, directionBlock } from '../run/holdNote'
import { runViewUrl } from '../run/provenance'
import { runResume } from '../run/resume'
import type { EngineClient } from '../engine/client'

/**
 * The "Resume" command: a hold note's Direction block, run as
 * `develop-direction`. The run itself is `src/run/resume.ts`; this is the
 * vault half — reading the note and canon, and writing back what the run
 * produced.
 */

export const NOT_A_HOLD_NOTE = 'Open a hold note to resume it'

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
    const content = await this.deps.app.vault.cachedRead(file)
    const direction = directionBlock(content)
    if (direction === undefined) {
      this.deps.notify(NOT_A_HOLD_NOTE)
      return
    }

    const canonPath = normalizePath(CANON_PATH)
    const canon = await readIfPresent(this.deps.app, canonPath)

    const outcome = await this.deps.withEngine(() => runResume(this.deps.engine, direction, canon))
    if (!outcome) return
    if (!outcome.runId) {
      this.deps.notify(outcome.error ? `Resume failed: ${outcome.error}` : 'Resume produced no run')
      return
    }

    const locked = tickedCanonLines(direction)
    if (locked.length > 0 && !outcome.error) await this.writeCanon(canonPath, locked)

    const linked = await this.linkRun(file, content, outcome.runId)
    if (!linked) return

    this.deps.notify(this.resumeNotice(outcome.runId, outcome.error, locked.length > 0))
  }

  private resumeNotice(runId: string, error: string | undefined, hadTicks: boolean): string {
    if (!error) return `Resumed as run ${runId}`
    const canonNote = hadTicks ? ' (canon not written)' : ''
    return `Resumed as run ${runId}, but it failed: ${error}${canonNote}`
  }

  /** Reads canon again right before writing — not the snapshot sent with the run — so a change made while the run was going is never clobbered. */
  private async writeCanon(path: string, lines: string[]): Promise<void> {
    await guardWrite(this.deps.notify, 'the canon file', async () => {
      await ensureFolder(this.deps.app, path.slice(0, path.lastIndexOf('/')))
      const current = this.deps.app.vault.getAbstractFileByPath(path)
      const fresh = appendLockedCanon(current instanceof TFile ? await this.deps.app.vault.cachedRead(current) : undefined, lines)
      if (current instanceof TFile) await this.deps.app.vault.modify(current, fresh)
      else await this.deps.app.vault.create(path, fresh)
    })
  }

  private async linkRun(file: TFile, content: string, runId: string): Promise<boolean> {
    const wrote = await guardWrite(this.deps.notify, 'the hold note', async () => {
      const url = runViewUrl(this.deps.engineUrl(), runId)
      await this.deps.app.vault.modify(file, appendResumeLink(content, { runId, ...(url ? { url } : {}) }))
      return true
    })
    return wrote === true
  }
}
