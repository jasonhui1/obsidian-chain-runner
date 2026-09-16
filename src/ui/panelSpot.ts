/**
 * Where a picker opens when it opens beside what it changes rather than
 * centre-screen (ADR-0010). Pure, so the flipping and clamping are checked
 * without a screen.
 */

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

/** A `Point` once it is a CSS offset, which is the only thing it may be used as. */
export interface Spot {
  left: number
  top: number
}

/** The size an anchored picker is opened at — declared, not measured (ADR-0010). */
export const PANEL: Size = { width: 340, height: 420 }

/** Kept clear of the click, so the panel does not open under the pointer. */
const GAP = 12

/** Never flush against the window edge. */
const MARGIN = 8

/** Below and right of `at`, flipped to the other side when that would run off. */
export function panelSpot(at: Point, panel: Size, viewport: Size): Spot {
  return {
    left: fit(at.x + GAP, at.x - GAP - panel.width, panel.width, viewport.width),
    top: fit(at.y + GAP, at.y - GAP - panel.height, panel.height, viewport.height),
  }
}

function fit(wanted: number, flipped: number, size: number, extent: number): number {
  const spot = wanted + size + MARGIN <= extent ? wanted : flipped
  return Math.max(MARGIN, Math.min(spot, extent - size - MARGIN))
}
