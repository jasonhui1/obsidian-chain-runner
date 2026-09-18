import type { App } from 'obsidian'
import { baseName, type NoteStore } from './noteStore'
import type { DrawingChoice } from './drawingChoices'
import { DrawingPicker } from './drawingPicker'
import type { DrawingSurface } from './excalidraw'
import type { OutputNotes } from './outputNotes'
import type { RunPanel } from '../run/panels'
import type { RunResult } from '../run/session'

/**
 * Keeping a piece of a run: the panel becomes a note, and the note optionally
 * lands on a drawing. What the note *is* lives in `src/run/outputNote.ts`, and
 * writing it in `./outputNotes.ts`; only the two result-view actions are here.
 */

export interface KeepPieceDeps {
  /** For the drawing picker. */
  app: App
  store: NoteStore
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
    const path = await this.write(panel, run)
    if (path) await this.deps.store.open(path)
  }

  /**
   * Puts the panel on a drawing as an embeddable. The note is written only after
   * a drawing is picked, so backing out at the modal leaves nothing behind, and
   * by `saveAsNote`'s rule, so saving then sending reuses the one note.
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
    const path = await this.write(panel, run)
    if (!path) return
    try {
      await this.deps.drawing.place(drawing, path)
      this.deps.notify(`${baseName(path)} → ${drawing.name}`)
    } catch (error) {
      this.deps.notify(error instanceof Error ? error.message : 'Could not reach that drawing')
    }
  }

  /** The output note on disk, written or already there. */
  private async write(panel: RunPanel, run: RunResult): Promise<string | undefined> {
    if (!run.runId) {
      this.deps.notify(NOT_SETTLED)
      return undefined
    }
    return this.deps.notes.write(panel, { runId: run.runId, chainName: run.chainName })
  }
}
