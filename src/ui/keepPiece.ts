import { normalizePath, TFile, TFolder, type App } from 'obsidian'
import { DrawingPicker } from './drawingPicker'
import type { DrawingSurface } from './excalidraw'
import { outputNoteContent, outputNotePath, resolveOutputPath, type OutputNoteMeta } from '../run/outputNote'
import type { RunPanel } from '../run/panels'
import type { RunResult } from '../run/session'

/**
 * Keeping a piece of a run: the panel becomes a note, and the note optionally
 * lands on a drawing.
 *
 * What the note *is* — its path, its frontmatter, what a collision does — is
 * `src/run/outputNote.ts` and checked without a vault. What is left here is the
 * vault itself: creating folders, writing the file, opening it, and asking which
 * drawing. The drawing surface is a seam for the same reason the engine's
 * transport is: Excalidraw cannot be driven from a test.
 */

export interface KeepPieceDeps {
  app: App
  notify: (message: string) => void
  /** Where output notes go. Read per action, so changing the setting takes at once. */
  folder: () => string
  drawing: DrawingSurface
}

/** Said when the run has no id yet — which is to say, has not finished. */
export const NOT_SETTLED = 'This run has no id yet — an output note is stamped with one. Wait for it to finish.'

export class KeepPiece {
  constructor(private readonly deps: KeepPieceDeps) {}

  /** Writes the panel as a note and opens it, which is the point of asking. */
  async saveAsNote(panel: RunPanel, run: RunResult): Promise<void> {
    const note = await this.write(panel, run)
    if (!note) return
    await this.deps.app.workspace.getLeaf(true).openFile(note)
  }

  /**
   * Writes the panel as a note and puts it on a drawing as an embeddable.
   *
   * The note is written first and by the same rule, so a piece sent to a drawing
   * and a piece saved are the same note — sending after saving reuses what is
   * already there rather than leaving two copies of one hop.
   */
  async sendToDrawing(panel: RunPanel, run: RunResult): Promise<void> {
    const unavailable = this.deps.drawing.unavailable()
    if (unavailable) {
      this.deps.notify(unavailable)
      return
    }
    const choices = this.deps.drawing.choices()
    if (choices.length === 0) {
      this.deps.notify('No Excalidraw drawing in this vault to send it to')
      return
    }
    const note = await this.write(panel, run)
    if (!note) return

    new DrawingPicker(this.deps.app, choices, drawing => {
      void this.place(drawing, note)
    }).open()
  }

  private async place(drawing: Parameters<DrawingSurface['place']>[0], note: TFile): Promise<void> {
    try {
      await this.deps.drawing.place(drawing, note)
      this.deps.notify(`${note.basename} → ${drawing.name}`)
    } catch (error) {
      this.deps.notify(error instanceof Error ? error.message : 'Could not reach that drawing')
    }
  }

  /** The output note on disk, written or already there. */
  private async write(panel: RunPanel, run: RunResult): Promise<TFile | undefined> {
    if (!run.runId) {
      this.deps.notify(NOT_SETTLED)
      return undefined
    }
    const meta: OutputNoteMeta = { runId: run.runId, chainName: run.chainName, folder: this.deps.folder() }
    const content = outputNoteContent(panel, meta)
    const wanted = normalizePath(outputNotePath(panel, meta))

    try {
      await this.ensureFolder(wanted.slice(0, wanted.lastIndexOf('/')))
      const path = await resolveOutputPath(wanted, content, part => this.read(part))
      const existing = this.deps.app.vault.getAbstractFileByPath(path)
      // The path either is free or already holds exactly this; a note that
      // already says it is kept as it is rather than rewritten.
      if (existing instanceof TFile) return existing
      return await this.deps.app.vault.create(path, content)
    } catch (error) {
      this.deps.notify(error instanceof Error ? `Could not write the note: ${error.message}` : 'Could not write the note')
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
