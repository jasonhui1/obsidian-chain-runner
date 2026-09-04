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
    const clicks = new PointerClicks()
    clicks.press({ x: 40, y: 90 }, 1000)
    const seen = watch(clicks)
    clicks.release({ x: 40, y: 90 }, 1080)
    expect(seen).toEqual([{ x: 40, y: 90 }])
  })

  it('forgives the wobble of a real click', () => {
    const clicks = new PointerClicks()
    clicks.press({ x: 40, y: 90 }, 1000)
    const seen = watch(clicks)
    clicks.release({ x: 42, y: 88 }, 1080)
    expect(seen).toEqual([{ x: 40, y: 90 }])
  })

  it('is not a click when the pointer travelled: that was a drag', () => {
    const clicks = new PointerClicks()
    clicks.press({ x: 40, y: 90 }, 1000)
    const seen = watch(clicks)
    clicks.release({ x: 300, y: 90 }, 1200)
    expect(seen).toEqual([undefined])
  })

  it('is not a click when the pointer was held down', () => {
    const clicks = new PointerClicks()
    clicks.press({ x: 40, y: 90 }, 1000)
    const seen = watch(clicks)
    clicks.release({ x: 40, y: 90 }, 3000)
    expect(seen).toEqual([undefined])
  })

  it('settles at once, with nothing, when no press is in flight', () => {
    expect(watch(new PointerClicks())).toEqual([undefined])
  })

  it('settles at once when the press already ended', () => {
    const clicks = new PointerClicks()
    clicks.press({ x: 40, y: 90 }, 1000)
    clicks.release({ x: 40, y: 90 }, 1080)
    expect(watch(clicks)).toEqual([undefined])
  })

  it('tells everyone waiting on the same press', () => {
    const clicks = new PointerClicks()
    clicks.press({ x: 40, y: 90 }, 1000)
    const first = watch(clicks)
    const second = watch(clicks)
    clicks.release({ x: 40, y: 90 }, 1080)
    expect(first).toEqual([{ x: 40, y: 90 }])
    expect(second).toEqual([{ x: 40, y: 90 }])
  })

  it('tells a caller only once, however the press ends', () => {
    const clicks = new PointerClicks()
    clicks.press({ x: 40, y: 90 }, 1000)
    const seen = watch(clicks)
    clicks.release({ x: 40, y: 90 }, 1080)
    clicks.release({ x: 40, y: 90 }, 1090)
    expect(seen).toHaveLength(1)
  })

  it('abandons a press that a new one interrupts', () => {
    const clicks = new PointerClicks()
    clicks.press({ x: 40, y: 90 }, 1000)
    const seen = watch(clicks)
    clicks.press({ x: 10, y: 10 }, 1100)
    expect(seen).toEqual([undefined])
  })

  it('abandons a press the window took away', () => {
    const clicks = new PointerClicks()
    clicks.press({ x: 40, y: 90 }, 1000)
    const seen = watch(clicks)
    clicks.cancel()
    expect(seen).toEqual([undefined])
  })
})
