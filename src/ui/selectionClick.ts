/**
 * When a change on the drawing counts as a click on one thing. Excalidraw's
 * scene-change hook fires on every change, so the decision lives here rather
 * than in `./excalidraw.ts`, where nothing could drive it (ADR-0010).
 */

/** Excalidraw's `appState.selectedElementIds`: selected ids mapped to `true`. */
export type SelectedIds = Record<string, boolean | undefined>

/** The single selected element, or `undefined` when the selection is not one. */
export function selectedOne(ids: SelectedIds | undefined): string | undefined {
  if (!ids) return undefined
  const selected = Object.keys(ids).filter(id => ids[id])
  return selected.length === 1 ? selected[0] : undefined
}

/**
 * Reads a run of selections as clicks: exactly one element, and not the one seen
 * last. A click on an already-selected element is invisible from here
 * (ADR-0010).
 */
export class SelectionClicks {
  private last: string | undefined

  /** The element just clicked, or `undefined` when this change is not a click on one. */
  clicked(ids: SelectedIds | undefined): string | undefined {
    const one = selectedOne(ids)
    if (one === this.last) return undefined
    this.last = one
    return one
  }
}
