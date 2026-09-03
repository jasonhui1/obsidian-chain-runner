import { normalizePath, TFile, TFolder, type App } from 'obsidian'
import {
  freeOutputPath,
  outputNoteContent,
  outputNotePath,
  resolveOutputPath,
  type OutputNoteMeta,
} from '../run/outputNote'
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
 *
 * There are two ways in, because the two surfaces know different things when
 * they ask. The result view keeps a panel that has already settled and hands
 * over its final text; a run on a drawing opens its notes before the first hop
 * and rewrites them as the hops write (ADR-0003).
 */

/** Which run a panel came from. The folder is settings', and read per write. */
export type RunProvenance = Omit<OutputNoteMeta, 'folder'>

/** A note a run holds open, to rewrite as its panel fills. */
export interface OpenOutputNote {
  file: TFile
  /** Rewrites the note from the panel as it now stands. */
  write(panel: RunPanel): Promise<void>
}

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

  /**
   * A note this run owns from now until it ends, created empty and rewritten as
   * its panel fills.
   *
   * The path is settled once, here, and never asked again: the note is placed on
   * a drawing as an embeddable moments later, and Excalidraw stores that path
   * inside its own scene file, where Obsidian's link-updating does not reach. A
   * note that moved after being placed would leave a dead embeddable.
   */
  async open(panel: RunPanel, run: RunProvenance): Promise<OpenOutputNote | undefined> {
    const meta: OutputNoteMeta = { ...run, folder: this.deps.folder() }
    const wanted = normalizePath(outputNotePath(panel, meta))
    try {
      await this.ensureFolder(wanted.slice(0, wanted.lastIndexOf('/')))
      const path = await freeOutputPath(wanted, candidate => this.read(candidate))
      const file = await this.deps.app.vault.create(path, outputNoteContent(panel, meta))
      let said = ''
      return {
        file,
        write: async next => {
          const content = outputNoteContent(next, meta)
          // A run redraws the whole note from the panel it is sent, so a flush
          // that would write what is already there is a vault write for nothing.
          if (content === said) return
          said = content
          await this.deps.app.vault.modify(file, content)
        },
      }
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
