import type { RerunSurface } from './excalidraw'
import { onDrawing } from './onDrawing'
import type { OutputNotes } from './outputNotes'
import type { RerunLanding } from '../run/rerunWatch'

/**
 * A landed rerun, followed on the drawing: each card of the old run is pointed
 * at a note filed under the new one, so the old notes stay the old run's record.
 * Only drawings open now can be reached.
 */

export interface RerunOnDrawingDeps {
  surface: RerunSurface
  notes: Pick<OutputNotes, 'write'>
  notify: (message: string) => void
}

export class RerunOnDrawing {
  constructor(private readonly deps: RerunOnDrawingDeps) {}

  /** Never throws: the hold has already moved on. */
  async land(landing: RerunLanding): Promise<void> {
    const { surface, notify } = this.deps
    if (surface.unavailable()) return
    const filed = new Map<string, Promise<string | undefined>>()
    const noteFor = (output: string): Promise<string | undefined> => {
      if (!filed.has(output)) filed.set(output, this.file(landing, output))
      return filed.get(output) as Promise<string | undefined>
    }
    for (const view of surface.openViews()) {
      await onDrawing(() => surface.on(view).followRerun(landing.from, landing.runId, noteFor), notify)
    }
  }

  /** The new run's note for `output`; `undefined` when that run has no such output, or the vault refused it. */
  private async file(landing: RerunLanding, output: string): Promise<string | undefined> {
    const panel = landing.panels.find(one => one.name === output)
    return panel && this.deps.notes.write(panel, { runId: landing.runId, chainName: landing.chainName })
  }
}
