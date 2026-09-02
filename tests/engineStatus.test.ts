import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EngineStatus, type EngineState } from '@/engine/status'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

/** A ping whose answer the test controls, and whose calls it can count. */
function scriptedPing(initial = true) {
  const state = { reachable: initial, calls: 0 }
  const ping = vi.fn(async () => {
    state.calls += 1
    return state.reachable
  })
  return { state, ping }
}

describe('EngineStatus', () => {
  it('starts unknown, before anything has been asked', () => {
    const { ping } = scriptedPing()
    expect(new EngineStatus(ping).state).toBe('unknown')
  })

  it('reaches online on the first poll after start', async () => {
    const { ping } = scriptedPing(true)
    const status = new EngineStatus(ping, { intervalMs: 3000 })
    status.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(status.state).toBe('online')
    expect(ping).toHaveBeenCalledTimes(1)
  })

  it('flips offline within one interval of the engine stopping', async () => {
    const { state, ping } = scriptedPing(true)
    const status = new EngineStatus(ping, { intervalMs: 3000 })
    status.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(status.state).toBe('online')

    state.reachable = false
    await vi.advanceTimersByTimeAsync(3000)
    expect(status.state).toBe('offline')
  })

  it('flips online within one interval of the engine starting', async () => {
    const { state, ping } = scriptedPing(false)
    const status = new EngineStatus(ping, { intervalMs: 3000 })
    status.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(status.state).toBe('offline')

    state.reachable = true
    await vi.advanceTimersByTimeAsync(3000)
    expect(status.state).toBe('online')
  })

  it('polls at most every few seconds, so an idle vault stays quiet', async () => {
    const { ping } = scriptedPing()
    const status = new EngineStatus(ping)
    status.start()
    await vi.advanceTimersByTimeAsync(0)
    const interval = status.intervalMs
    expect(interval).toBeGreaterThanOrEqual(1000)
    expect(interval).toBeLessThanOrEqual(5000)
  })

  it('notifies subscribers only when the state actually changes', async () => {
    const { state, ping } = scriptedPing(true)
    const status = new EngineStatus(ping, { intervalMs: 1000 })
    const seen: EngineState[] = []
    status.onChange(next => seen.push(next))

    status.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    state.reachable = false
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)

    expect(seen).toEqual(['online', 'offline'])
  })

  it('lets a subscriber unsubscribe', async () => {
    const { state, ping } = scriptedPing(true)
    const status = new EngineStatus(ping, { intervalMs: 1000 })
    const seen: EngineState[] = []
    const off = status.onChange(next => seen.push(next))

    status.start()
    await vi.advanceTimersByTimeAsync(0)
    off()
    state.reachable = false
    await vi.advanceTimersByTimeAsync(1000)

    expect(seen).toEqual(['online'])
  })

  it('stops polling once stopped', async () => {
    const { ping } = scriptedPing()
    const status = new EngineStatus(ping, { intervalMs: 1000 })
    status.start()
    await vi.advanceTimersByTimeAsync(0)
    status.stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(ping).toHaveBeenCalledTimes(1)
  })

  it('does not stack a second poll on top of a slow one', async () => {
    let release: (() => void) | undefined
    const ping = vi.fn(() => new Promise<boolean>(resolve => (release = () => resolve(true))))
    const status = new EngineStatus(ping, { intervalMs: 1000 })
    status.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(ping).toHaveBeenCalledTimes(1)

    release!()
    await vi.advanceTimersByTimeAsync(1000)
    expect(ping).toHaveBeenCalledTimes(2)
  })

  it('reads a thrown ping as offline rather than letting it escape', async () => {
    const ping = vi.fn(async () => {
      throw new Error('unparseable engine URL')
    })
    const status = new EngineStatus(ping, { intervalMs: 1000 })
    status.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(status.state).toBe('offline')
  })

  it('refresh joins an in-flight poll rather than answering from a stale state', async () => {
    let release: ((reachable: boolean) => void) | undefined
    const ping = vi.fn(() => new Promise<boolean>(resolve => (release = resolve)))
    const status = new EngineStatus(ping, { intervalMs: 1000 })
    status.start()
    await vi.advanceTimersByTimeAsync(0)

    // An action fired while the very first check is still out must not be told
    // "offline" just because nothing has answered yet.
    const pending = status.refresh()
    release!(true)
    expect(await pending).toBe('online')
    expect(ping).toHaveBeenCalledTimes(1)
  })

  it('markOffline flips the state without waiting for a poll', async () => {
    const { ping } = scriptedPing(true)
    const status = new EngineStatus(ping, { intervalMs: 3000 })
    const seen: EngineState[] = []
    status.onChange(next => seen.push(next))
    status.start()
    await vi.advanceTimersByTimeAsync(0)

    status.markOffline()
    expect(status.state).toBe('offline')
    expect(seen).toEqual(['online', 'offline'])
  })

  it('refresh checks now and restarts the interval from that moment', async () => {
    const { state, ping } = scriptedPing(false)
    const status = new EngineStatus(ping, { intervalMs: 3000 })
    status.start()
    await vi.advanceTimersByTimeAsync(0)

    state.reachable = true
    expect(await status.refresh()).toBe('online')
    expect(ping).toHaveBeenCalledTimes(2)

    // The interval was rearmed by the refresh, so nothing fires until a full one passes.
    await vi.advanceTimersByTimeAsync(2999)
    expect(ping).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(ping).toHaveBeenCalledTimes(3)
  })

  it('refresh works before start, for a one-off check', async () => {
    const { ping } = scriptedPing(true)
    const status = new EngineStatus(ping, { intervalMs: 3000 })
    expect(await status.refresh()).toBe('online')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(ping).toHaveBeenCalledTimes(1)
  })
})
