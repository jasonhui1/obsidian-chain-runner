import type { Point } from './panelSpot'

/**
 * Whether the press in flight turns out to be a click, and where. Excalidraw
 * reports a selection the moment the pointer goes down, which is too early to
 * know: a drag begins the same way, and a keyboard selection has no press
 * behind it at all (ADR-0010).
 */

/** A click may wobble; past this the reader was dragging. */
const SLOP_PX = 4

/** Past this the pointer was held, not clicked. */
const HELD_MS = 700

/** Told where the click was, or `undefined` when the press was not one. */
type Settle = (spot: Point | undefined) => void

interface Press extends Point {
  when: number
  waiting: Settle[]
}

export class PointerClicks {
  private press_: Press | undefined
  private last: Point | undefined

  press(point: Point, when: number): void {
    // A press arriving with one still in flight means the last one was lost.
    this.cancel()
    this.press_ = { x: point.x, y: point.y, when, waiting: [] }
    this.last = { x: point.x, y: point.y }
  }

  /** Where the reader last pressed, for a route that already knows a click happened. */
  pressed(): Point | undefined {
    return this.last
  }

  release(point: Point, when: number): void {
    const press = this.take()
    if (!press) return
    settle(press, isClick(press, point, when) ? { x: press.x, y: press.y } : undefined)
  }

  /** The window took the pointer away, so nothing more is coming. */
  cancel(): void {
    const press = this.take()
    if (press) settle(press, undefined)
  }

  /**
   * Answers `settled` once the press in flight ends — at once, with nothing,
   * when there is none, which is what a keyboard selection looks like.
   */
  onSettled(settled: Settle): void {
    if (this.press_) this.press_.waiting.push(settled)
    else settled(undefined)
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
