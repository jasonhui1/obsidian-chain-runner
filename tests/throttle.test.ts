import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createThrottle, RENDER_INTERVAL_MS } from '@/ui/throttle'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createThrottle', () => {
  it('runs the first call at once, so nothing waits to appear', () => {
    const run = vi.fn()
    createThrottle(100).run(run)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('holds the calls that follow, and runs the last of them at the interval', () => {
    const throttle = createThrottle(100)
    const first = vi.fn()
    const second = vi.fn()
    const third = vi.fn()
    throttle.run(first)
    throttle.run(second)
    throttle.run(third)
    expect(second).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    // Only the last one: a token dropped mid-stream is one the next frame supersedes.
    expect(second).not.toHaveBeenCalled()
    expect(third).toHaveBeenCalledTimes(1)
  })

  it('runs at once again once an interval has passed idle', () => {
    const throttle = createThrottle(100)
    throttle.run(() => {})
    vi.advanceTimersByTime(200)
    const later = vi.fn()
    throttle.run(later)
    expect(later).toHaveBeenCalledTimes(1)
  })

  it('flushes what is held, so the last frame of a run is never the one dropped', () => {
    const throttle = createThrottle(100)
    const last = vi.fn()
    throttle.run(() => {})
    throttle.run(last)
    throttle.flush()
    expect(last).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(100)
    expect(last).toHaveBeenCalledTimes(1)
  })

  it('flushes to nothing when nothing is held', () => {
    const throttle = createThrottle(100)
    expect(() => throttle.flush()).not.toThrow()
  })

  it('cancels what is held', () => {
    const throttle = createThrottle(100)
    const dropped = vi.fn()
    throttle.run(() => {})
    throttle.run(dropped)
    throttle.cancel()
    vi.advanceTimersByTime(100)
    expect(dropped).not.toHaveBeenCalled()
  })

  it('re-renders about ten times a second', () => {
    expect(RENDER_INTERVAL_MS).toBe(100)
  })
})
