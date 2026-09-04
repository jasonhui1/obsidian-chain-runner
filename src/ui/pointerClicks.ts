import type { Point } from './panelSpot'

/**
 * Whether the press behind a selection was a click, and where. Excalidraw
 * reports a selection on pointer-*down*, where a drag looks exactly like a
 * click and a keyboard selection has no press at all — and it reports it
 * through React, so it may equally arrive after the pointer is back up
 * (ADR-0010). Both orders are answered.
 */

/** A click may wobble; past this the reader was dragging. */
const SLOP_PX = 4

/** Past this the pointer was held, not clicked. */
const HELD_MS = 700

/** How long a finished click stays available to a selection still being reported. */
const REPORTED_WITHIN_MS = 500

/** Told where the click was, or `undefined` when the press was not one. */
type Settle = (spot: Point | undefined) => void

interface Press extends Point {
  when: number
  waiting: Settle[]
}

export class PointerClicks {
  private press_: Press | undefined
  /** The last click nothing has claimed yet, kept for a selection reported late. */
  private unclaimed: (Point & { when: number }) | undefined
  private last: Point | undefined

  constructor(private readonly now: () => number) {}

  press(point: Point, when: number): void {
    // A press arriving with one still in flight means the last one was lost.
    this.cancel()
    this.press_ = { x: point.x, y: point.y, when, waiting: [] }
    this.last = { x: point.x, y: point.y }
  }

  release(point: Point, when: number): void {
    const press = this.take()
    if (!press) return
    const spot = isClick(press, point, when) ? { x: press.x, y: press.y } : undefined
    // Anyone already waiting claims it; otherwise it is held for a late report.
    if (press.waiting.length > 0) settle(press, spot)
    else this.unclaimed = spot ? { ...spot, when } : undefined
  }

  /** The window took the pointer away, so nothing more is coming. */
  cancel(): void {
    const press = this.take()
    if (press) settle(press, undefined)
  }

  /** Where the reader last pressed, for a route that already knows a click happened. */
  pressed(): Point | undefined {
    return this.last
  }

  /**
   * Answers `settled` with where the click was: when the press ends if one is in
   * flight, and at once from the click just finished if the report came after
   * the pointer was up. A drag, a hold and a keyboard selection all answer
   * nothing. One click is answered once.
   */
  onSettled(settled: Settle): void {
    if (this.press_) {
      this.press_.waiting.push(settled)
      return
    }
    const claimed = this.unclaimed
    this.unclaimed = undefined
    settled(claimed && this.now() - claimed.when <= REPORTED_WITHIN_MS ? { x: claimed.x, y: claimed.y } : undefined)
  }

  private take(): Press | undefined {
    const press = this.press_
    this.press_ = undefined
    return press
  }
}

function isClick(press: Press, at: Point, when: number): boolean {
  return (
    when - press.when <= HELD_MS && Math.abs(at.x - press.x) <= SLOP_PX && Math.abs(at.y - press.y) <= SLOP_PX
  )
}

function settle(press: Press, spot: Point | undefined): void {
  for (const waiting of press.waiting) waiting(spot)
}
