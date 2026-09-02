import { describe, it, expect } from 'vitest'
import { noticeFor } from '@/ui/panelCopy'
import type { RunPanel } from '@/run/panels'

const panel = (over: Partial<RunPanel>): RunPanel =>
  ({ name: 'hop 1', node: 'first', text: '', lines: 0, state: 'pending', ...over })

describe('noticeFor', () => {
  it('says nothing about a panel that has content', () => {
    expect(noticeFor(panel({ state: 'filled', text: 'x', lines: 1 }), 'running')).toBeNull()
  })

  it('says a panel still streaming is writing, not waiting', () => {
    expect(noticeFor(panel({ streaming: 'half a sen' }), 'running')?.tone).toBe('writing')
  })

  it('says a pending panel in a live run is waiting', () => {
    expect(noticeFor(panel({}), 'running')).toMatchObject({ tone: 'waiting' })
  })

  it('says a pending panel in a settled run never ran, since nothing is coming', () => {
    expect(noticeFor(panel({}), 'done')?.text).toBe('never ran')
  })

  it('names an empty panel as a hop that dropped what it was asked for, not one that failed', () => {
    const notice = noticeFor(panel({ state: 'empty' }), 'done')
    expect(notice?.tone).toBe('empty')
    expect(notice?.text).toContain('dropped')
  })

  it('carries the engine own message on a failed hop', () => {
    const notice = noticeFor(panel({ state: 'errored', error: 'the model refused' }), 'failed')
    expect(notice?.tone).toBe('errored')
    expect(notice?.text).toContain('the model refused')
  })

  it('still says a hop failed when the engine gave no reason', () => {
    expect(noticeFor(panel({ state: 'errored' }), 'failed')?.text).toBe('this hop failed')
  })

  it('says a skipped panel is a branch that went the other way', () => {
    expect(noticeFor(panel({ state: 'skipped' }), 'done')).toMatchObject({ tone: 'skipped' })
  })
})
