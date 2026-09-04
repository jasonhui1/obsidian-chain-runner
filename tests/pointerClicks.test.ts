import { describe, it, expect } from 'vitest'
import { PointerClicks } from '@/ui/pointerClicks'

/**
 * Whether the press in flight is going to be a click. Excalidraw reports a
 * selection the moment the pointer goes down, which is too early to know — a
 * drag starts the same way, and a keyboard selection has no press at all
 * (ADR-0010).
 */

/** Collects what a waiting caller is told, so a test reads it after the release. */
function watch(clicks: PointerClicks): (Point | undefined)[] {
  const seen: (Point | undefined)[] = []
  clicks.onSettled(spot => seen.push(spot))
  return seen
}

interface Point {
  x: number
  y: number
}

describe('PointerClicks', () => {
  it('settles on the press once the pointer comes up where it went down', () => {
    const clicks = new PointerClicks(() => 0)
    clicks.press({ x: 40, y: 90 }, 1000)
    const seen = watch(clicks)
    clicks.release({ x: 40, y: 90 }, 1080)
    expect(seen).toEqual([{ x: 40, y: 90 }])
  })

  it('forgives the wobble of a real click', () => {
    const clicks = new PointerClicks(() => 0)
    clicks.press({ x: 40, y: 90 }, 1000)
    const seen = watch(clicks)
    clicks.release({ x: 42, y: 88 }, 1080)
    expect(seen).toEqual([{ x: 40, y: 90 }])
  })

  it('is not a click when the pointer travelled: that was a drag', () => {
    const clicks = new PointerClicks(() => 0)
    clicks.press({ x: 40, y: 90 }, 1000)
    const seen = watch(clicks)
    clicks.release({ x: 300, y: 90 }, 1200)
    expect(seen).toEqual([undefined])
  })

  it('is not a click when the pointer was held down', () => {
    const clicks = new PointerClicks(() => 0)
    clicks.press({ x: 40, y: 90 }, 1000)
    const seen = watch(clicks)
    clicks.release({ x: 40, y: 90 }, 3000)
    expect(seen).toEqual([undefined])
  })

  it('settles at once, with nothing, when no press is in flight', () => {
    expect(watch(new PointerClicks(() => 1000))).toEqual([undefined])
  })

  it('answers a click that has only just finished', () => {
    // The drawing reports a selection after the pointer is already back up.
    let now = 1000
    const clicks = new PointerClicks(() => now)
    clicks.press({ x: 40, y: 90 }, 1000)
    clicks.release({ x: 40, y: 90 }, 1080)
    now = 1120
    expect(watch(clicks)).toEqual([{ x: 40, y: 90 }])
  })

  it('answers a finished click once, so one click opens one thing', () => {
    let now = 1000
    const clicks = new PointerClicks(() => now)
    clicks.press({ x: 40, y: 90 }, 1000)
    clicks.release({ x: 40, y: 90 }, 1080)
    now = 1120
    watch(clicks)
    expect(watch(clicks)).toEqual([undefined])
  })

  it('forgets a finished click too old to be what the drawing is reporting', () => {
    let now = 1000
    const clicks = new PointerClicks(() => now)
    clicks.press({ x: 40, y: 90 }, 1000)
    clicks.release({ x: 40, y: 90 }, 1080)
    now = 5000
    expect(watch(clicks)).toEqual([undefined])
  })

  it('leaves nothing behind after a drag, however late the drawing reports it', () => {
    let now = 1000
    const clicks = new PointerClicks(() => now)
    clicks.press({ x: 40, y: 90 }, 1000)
    clicks.release({ x: 300, y: 90 }, 1200)
    now = 1240
    expect(watch(clicks)).toEqual([undefined])
  })

  it('tells everyone waiting on the same press', () => {
    const clicks = new PointerClicks(() => 0)
    clicks.press({ x: 40, y: 90 }, 1000)
    const first = watch(clicks)
    const second = watch(clicks)
    clicks.release({ x: 40, y: 90 }, 1080)
    expect(first).toEqual([{ x: 40, y: 90 }])
    expect(second).toEqual([{ x: 40, y: 90 }])
  })

  it('tells a caller only once, however the press ends', () => {
    const clicks = new PointerClicks(() => 0)
    clicks.press({ x: 40, y: 90 }, 1000)
    const seen = watch(clicks)
    clicks.release({ x: 40, y: 90 }, 1080)
    clicks.release({ x: 40, y: 90 }, 1090)
    expect(seen).toHaveLength(1)
  })

  it('abandons a press that a new one interrupts', () => {
    const clicks = new PointerClicks(() => 0)
    clicks.press({ x: 40, y: 90 }, 1000)
    const seen = watch(clicks)
    clicks.press({ x: 10, y: 10 }, 1100)
    expect(seen).toEqual([undefined])
  })

  it('abandons a press the window took away', () => {
    const clicks = new PointerClicks(() => 0)
    clicks.press({ x: 40, y: 90 }, 1000)
    const seen = watch(clicks)
    clicks.cancel()
    expect(seen).toEqual([undefined])
  })
})

describe('PointerClicks, counting a double', () => {
  /** Collects each double the presses add up to. */
  function doubles(clicks: PointerClicks): number[] {
    const seen: number[] = []
    clicks.onDouble(() => seen.push(seen.length))
    return seen
  }

  /** One click, pressed and released on the spot. */
  function click(clicks: PointerClicks, at: Point, when: number): void {
    clicks.press(at, when)
    clicks.release(at, when + 40)
  }

  it('reads two clicks in the same place, in quick succession, as a double', () => {
    const clicks = new PointerClicks(() => 0)
    const seen = doubles(clicks)
    click(clicks, { x: 40, y: 90 }, 1000)
    expect(seen).toEqual([])
    click(clicks, { x: 40, y: 90 }, 1150)
    expect(seen).toEqual([0])
  })

  it('forgives the wobble between the two', () => {
    const clicks = new PointerClicks(() => 0)
    const seen = doubles(clicks)
    click(clicks, { x: 40, y: 90 }, 1000)
    click(clicks, { x: 43, y: 92 }, 1150)
    expect(seen).toEqual([0])
  })

  it('is two separate clicks when they are too far apart in time', () => {
    const clicks = new PointerClicks(() => 0)
    const seen = doubles(clicks)
    click(clicks, { x: 40, y: 90 }, 1000)
    click(clicks, { x: 40, y: 90 }, 3000)
    expect(seen).toEqual([])
  })

  it('is two separate clicks when they are too far apart on the screen', () => {
    const clicks = new PointerClicks(() => 0)
    const seen = doubles(clicks)
    click(clicks, { x: 40, y: 90 }, 1000)
    click(clicks, { x: 400, y: 90 }, 1150)
    expect(seen).toEqual([])
  })

  it('does not count a drag as half of a double', () => {
    const clicks = new PointerClicks(() => 0)
    const seen = doubles(clicks)
    click(clicks, { x: 40, y: 90 }, 1000)
    clicks.press({ x: 40, y: 90 }, 1100)
    clicks.release({ x: 300, y: 90 }, 1200)
    click(clicks, { x: 40, y: 90 }, 1250)
    expect(seen).toEqual([])
  })

  it('reads a third click as the start of the next double, not a second one', () => {
    const clicks = new PointerClicks(() => 0)
    const seen = doubles(clicks)
    click(clicks, { x: 40, y: 90 }, 1000)
    click(clicks, { x: 40, y: 90 }, 1150)
    click(clicks, { x: 40, y: 90 }, 1300)
    expect(seen).toEqual([0])
  })
})
