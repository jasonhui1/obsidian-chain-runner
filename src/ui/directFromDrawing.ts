import type { DrawingView, SelectionSurface } from './excalidraw'
import { directLabelRunId } from './runLabel'
import { holdStamp } from './holdColumn'
import { UNREACHABLE_DRAWING } from './onDrawing'
import type { Point } from './panelSpot'

/**
 * Directing a run from the drawing: a click on its frame's `✎ Direct` or on one
 * of its cards, or the palette on a selected card.
 */

export const SELECT_A_RUN = 'Select a card from a run on the drawing to direct that run.'

export interface DirectFromDrawingDeps {
  surface: SelectionSurface
  direct: (runId: string) => Promise<void>
  showProposal: (runId: string, proposal: string) => Promise<void>
  showHold: (runId: string, nodeId: string) => Promise<void>
  notify: (message: string) => void
  /** Where the press behind a selection settled, or `undefined` for a drag (ADR-0010). */
  clickSpot: (settled: (spot: Point | undefined) => void) => void
}

export class DirectFromDrawing {
  constructor(private readonly deps: DirectFromDrawingDeps) {}

  /** Ctrl/Cmd+click on the label. `true` passes on a link that is not ours. */
  handleLinkClick(element: { customData?: unknown }): boolean {
    const candidate = holdStamp(element)
    if (candidate?.role === 'candidate') {
      void this.deps.showHold(candidate.runId, candidate.nodeId)
      return false
    }
    const runId = directLabelRunId(element)
    if (!runId) return true
    void this.deps.direct(runId)
    return false
  }

  /** A plain click on the label or a card, once the press is known not to be a drag. */
  handleSelection(element: { customData?: unknown }, view: DrawingView): void {
    const candidate = holdStamp(element)
    if (candidate?.role === 'candidate') {
      this.deps.clickSpot(spot => { if (spot) void this.deps.showHold(candidate.runId, candidate.nodeId) })
      return
    }
    const runId = directLabelRunId(element)
    const card = runId ? undefined : this.deps.surface.cardProposal(element, view)
    if (!runId && !card) return
    this.deps.clickSpot(spot => {
      if (!spot) return
      if (runId) void this.deps.direct(runId)
      else if (card) void this.deps.showProposal(card.runId, card.proposal)
    })
  }

  /** The palette command, on whatever card of a run is selected. */
  async directSelected(): Promise<void> {
    const unavailable = this.deps.surface.unavailable()
    if (unavailable) {
      this.deps.notify(unavailable)
      return
    }
    let runId: string | undefined
    try {
      runId = this.deps.surface.selectedRun()
    } catch (error) {
      this.deps.notify(error instanceof Error ? error.message : UNREACHABLE_DRAWING)
      return
    }
    if (!runId) {
      this.deps.notify(SELECT_A_RUN)
      return
    }
    await this.deps.direct(runId)
  }
}
