import { describe, it, expect, vi } from 'vitest'
import { createEngineGuard, OFFLINE_NOTICE } from '@/engine/guard'
import { EngineHttpError, EngineOfflineError } from '@/engine/transport'
import type { EngineState } from '@/engine/status'

function guardWith(state: EngineState) {
  const notify = vi.fn()
  const refresh = vi.fn(async () => state)
  const markOffline = vi.fn()
  return { notify, refresh, markOffline, guard: createEngineGuard({ refresh, notify, markOffline }) }
}

describe('createEngineGuard', () => {
  it('runs the action and returns its value when the engine is up', async () => {
    const { guard, notify } = guardWith('online')
    expect(await guard(async () => 'chains')).toBe('chains')
    expect(notify).not.toHaveBeenCalled()
  })

  it('shows one notice and does nothing else when the engine is down', async () => {
    const { guard, notify } = guardWith('offline')
    const action = vi.fn()
    expect(await guard(action)).toBeUndefined()
    expect(action).not.toHaveBeenCalled()
    expect(notify.mock.calls).toEqual([[OFFLINE_NOTICE]])
  })

  it('checks the engine now rather than trusting the last poll', async () => {
    const { guard, refresh } = guardWith('online')
    await guard(async () => undefined)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('treats an engine that goes down mid-action as offline too', async () => {
    const { guard, notify, markOffline } = guardWith('online')
    const result = await guard(async () => {
      throw new EngineOfflineError('http://localhost:3000')
    })
    expect(result).toBeUndefined()
    expect(notify.mock.calls).toEqual([[OFFLINE_NOTICE]])
    // The pill should not wait out an interval to agree with the notice.
    expect(markOffline).toHaveBeenCalledOnce()
  })

  it('reports an engine that answered with an error as itself, not as offline', async () => {
    const { guard, notify, markOffline } = guardWith('online')
    const result = await guard(async () => {
      throw new EngineHttpError(404, 'http://localhost:3000/api/runs/x', 'Run not found')
    })
    expect(result).toBeUndefined()
    expect(notify).toHaveBeenCalledOnce()
    expect(notify.mock.calls[0][0]).not.toBe(OFFLINE_NOTICE)
    expect(notify.mock.calls[0][0]).toContain('404')
    expect(markOffline).not.toHaveBeenCalled()
  })

  it('lets an unexpected failure surface rather than swallowing it', async () => {
    const { guard } = guardWith('online')
    await expect(
      guard(async () => {
        throw new TypeError('a real bug')
      }),
    ).rejects.toBeInstanceOf(TypeError)
  })
})
