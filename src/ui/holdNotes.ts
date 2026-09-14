import { normalizePath, TFile, type App } from 'obsidian'
import { holdNoteContent, holdNotePath, mergeHoldNote, type HoldNoteInput } from '../run/holdNote'
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

  async write(input: HoldNoteInput): Promise<TFile | undefined> {
    const path = normalizePath(holdNotePath(input.runId))
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
