import type { TFile, App } from 'obsidian'
import type { DrawingChoice } from './drawingChoices'
import { DrawingPicker } from './drawingPicker'
import type { DrawingSurface } from './excalidraw'
import type { OutputNotes } from './outputNotes'
import type { RunPanel } from '../run/panels'
import type { RunResult } from '../run/session'

/**
 * Keeping a piece of a run: the panel becomes a note, and the note optionally
 * lands on a drawing.
 *
 * What the note *is* — its path, its frontmatter, what a collision does — is
 * `src/run/outputNote.ts`, and writing it is `./outputNotes.ts`, which the
 * drawing's own runs share. What is left here is the two actions the result view
 * offers: open what was written, or ask which drawing to put it on. The drawing
 * surface is a seam for the same reason the engine's transport is: Excalidraw
 * cannot be driven from a test.
 */

export interface KeepPieceDeps {
  app: App
  notify: (message: string) => void
  /** The output-note convention, shared with the drawing's own runs. */
  notes: OutputNotes
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
   * Puts the panel on a drawing as an embeddable, writing its note on the way.
   *
   * Everything that could stop the action is checked before the suggester opens,
   * and the note is written after a drawing is picked — a reader who changes
   * their mind at the modal should leave nothing behind in the vault.
   *
   * The note is written by the same rule `saveAsNote` uses, so a piece sent to a
   * drawing and a piece saved are the same note: sending after saving reuses
   * what is already there rather than leaving two copies of one hop.
   */
  async sendToDrawing(panel: RunPanel, run: RunResult): Promise<void> {
    if (!run.runId) {
      this.deps.notify(NOT_SETTLED)
      return
    }
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

    new DrawingPicker(this.deps.app, choices, drawing => {
      void this.place(drawing, panel, run)
    }).open()
  }

  private async place(drawing: DrawingChoice, panel: RunPanel, run: RunResult): Promise<void> {
    const note = await this.write(panel, run)
    if (!note) return
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
    return this.deps.notes.write(panel, { runId: run.runId, chainName: run.chainName })
  }
}
