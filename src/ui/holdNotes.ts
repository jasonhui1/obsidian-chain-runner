import { normalizePath, TFile, type App } from 'obsidian'
import { holdHeading, holdNoteContent, holdNotePath, mergeHoldNote, reranFrom, type HoldNoteInput } from '../run/holdNote'
import { ensureFolder, guardWrite } from './vaultWrite'

/**
 * The vault half of the hold-note convention; the note itself is
 * `src/run/holdNote.ts`. A run directed twice writes the same file, merged so
 * the human's Direction is never overwritten.
 */

export class HoldNotes {
  constructor(
    private readonly deps: {
      app: App
      notify: (message: string) => void
    },
  ) {}

  /** Where the run's hold note is, written or not. */
  pathOf(runId: string): string {
    return normalizePath(holdNotePath(runId))
  }

  /** The run's hold note, if one has been written. */
  find(runId: string): TFile | undefined {
    const file = this.deps.app.vault.getAbstractFileByPath(this.pathOf(runId))
    return file instanceof TFile ? file : undefined
  }

  /** The run `runId`'s hold now lives under: itself, or the newest run a rerun moved its hold to. */
  async currentRun(runId: string): Promise<string> {
    if (this.find(runId)) return runId
    const { vault } = this.deps.app
    const path = this.pathOf(runId)
    const holds = vault
      .getMarkdownFiles()
      .filter(file => file.path.startsWith(path.slice(0, path.lastIndexOf('/') + 1)))
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
    for (const file of holds) {
      const content = await vault.cachedRead(file)
      const heading = holdHeading(content)
      if (heading && reranFrom(content).includes(runId)) return heading.runId
    }
    return runId
  }

  async write(input: HoldNoteInput): Promise<TFile | undefined> {
    const path = this.pathOf(input.runId)
    const fresh = holdNoteContent(input)
    return guardWrite(this.deps.notify, 'the hold note', async () => {
      await ensureFolder(this.deps.app, path.slice(0, path.lastIndexOf('/')))
      const existing = this.deps.app.vault.getAbstractFileByPath(path)
      if (existing instanceof TFile) {
        const previous = await this.deps.app.vault.cachedRead(existing)
        const merged = mergeHoldNote(fresh, previous)
        if (merged !== previous) await this.deps.app.vault.modify(existing, merged)
        return existing
      }
      return this.deps.app.vault.create(path, fresh)
    })
  }
}
