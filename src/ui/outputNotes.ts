import { normalizePath, TFile, TFolder, type App } from 'obsidian'
import { outputNoteContent, outputNotePath, resolveOutputPath, type OutputNoteMeta } from '../run/outputNote'
import type { RunPanel } from '../run/panels'

/**
 * The vault half of the output-note convention.
 *
 * What the note *is* — its path, its frontmatter, what a second save of the same
 * panel does — is `src/run/outputNote.ts` and checked without a vault. What is
 * left here is the writing: folders made a segment at a time, and a note that
 * already says exactly this reused rather than duplicated.
 *
 * Both surfaces that keep a piece of a run go through this, so a panel saved
 * from the sidebar and the same panel landing on a drawing are one note.
 */

/** Which run a panel came from. The folder is settings', and read per write. */
export type RunProvenance = Omit<OutputNoteMeta, 'folder'>

export interface OutputNotesDeps {
  app: App
  notify: (message: string) => void
  /** Where output notes go. Read per write, so changing the setting takes at once. */
  folder: () => string
}

export class OutputNotes {
  constructor(private readonly deps: OutputNotesDeps) {}

  /**
   * The note for a panel, written or already there. `undefined` means the vault
   * refused it, which has been said as a notice by then — the caller has nothing
   * left to decide.
   */
  async write(panel: RunPanel, run: RunProvenance): Promise<TFile | undefined> {
    const meta: OutputNoteMeta = { ...run, folder: this.deps.folder() }
    const content = outputNoteContent(panel, meta)
    const wanted = normalizePath(outputNotePath(panel, meta))

    try {
      await this.ensureFolder(wanted.slice(0, wanted.lastIndexOf('/')))
      const path = await resolveOutputPath(wanted, content, candidate => this.read(candidate))
      const existing = this.deps.app.vault.getAbstractFileByPath(path)
      // The path either is free or already holds exactly this; a note that
      // already says it is kept as it is rather than rewritten.
      if (existing instanceof TFile) return existing
      return await this.deps.app.vault.create(path, content)
    } catch (error) {
      this.deps.notify(
        error instanceof Error ? `Could not write the note: ${error.message}` : 'Could not write the note',
      )
      return undefined
    }
  }

  private async read(path: string): Promise<string | undefined> {
    const file = this.deps.app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return undefined
    return this.deps.app.vault.cachedRead(file)
  }

  /** Creates the run's folder and everything above it, a segment at a time. */
  private async ensureFolder(folder: string): Promise<void> {
    const segments = folder.split('/').filter(segment => segment !== '')
    let path = ''
    for (const segment of segments) {
      path = path === '' ? segment : `${path}/${segment}`
      const existing = this.deps.app.vault.getAbstractFileByPath(path)
      if (existing instanceof TFolder) continue
      // A note sitting where the folder should be is the reader's, not ours to move.
      if (existing) throw new Error(`${path} is a note, not a folder`)
      await this.deps.app.vault.createFolder(path)
    }
  }
}
