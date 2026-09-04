import { describe, it, expect } from 'vitest'
import { emptyStateFor, type EmptyStateInput } from '@/ui/emptyState'
import type { EngineState } from '@/engine/status'

const URL = 'http://localhost:3000'

function state(over: Partial<EmptyStateInput> = {}) {
  return emptyStateFor({ run: undefined, engine: { state: 'online', url: URL }, ...over })
}

describe('emptyStateFor: nothing has been run', () => {
  it('invites a run when the engine is there', () => {
    const empty = state()
    expect(empty.tone).toBe('idle')
    expect(empty.hint).toContain('Run chain on this note')
  })

  it('says the engine is missing, and where it looked, rather than inviting a run', () => {
    const empty = state({ engine: { state: 'offline', url: URL } })
    expect(empty.tone).toBe('offline')
    expect(empty.hint).toContain(URL)
  })

  it('does not claim offline before the first check has answered', () => {
    expect(state({ engine: { state: 'unknown', url: URL } }).tone).toBe('idle')
  })
})

describe('emptyStateFor: a run with no panels yet', () => {
  it('says the run is going, not that nothing has been run', () => {
    const empty = state({ run: { status: 'running' } })
    expect(empty.tone).toBe('waiting')
    expect(empty.title).not.toBe(state().title)
  })

  it('points at the reason already on screen when the run failed', () => {
    const empty = state({ run: { status: 'failed' } })
    expect(empty.tone).toBe('failed')
  })

  it('distinguishes a run that finished holding nothing from one that never started', () => {
    const done = state({ run: { status: 'done' } })
    expect(done.tone).toBe('idle')
    expect(done.title).not.toBe(state().title)
  })

  it('lets a launched run speak for itself, whatever the engine is doing now', () => {
    const engines: EngineState[] = ['online', 'offline', 'unknown']
    const tones = engines.map(state => emptyStateFor({ run: { status: 'running' }, engine: { state, url: URL } }).tone)
    expect(new Set(tones)).toEqual(new Set(['waiting']))
  })
})

describe('emptyStateFor: every state is a designed one', () => {
  it('gives each a title and a hint, and never an empty string', () => {
    const online = { state: 'online', url: URL } as const
    const cases: EmptyStateInput[] = [
      { run: undefined, engine: online },
      { run: undefined, engine: { state: 'offline', url: URL } },
      { run: { status: 'running' }, engine: online },
      { run: { status: 'failed' }, engine: online },
      { run: { status: 'done' }, engine: online },
    ]
    for (const input of cases) {
      const empty = emptyStateFor(input)
      expect(empty.title.length).toBeGreaterThan(0)
      expect(empty.hint.length).toBeGreaterThan(0)
    }
  })
})
