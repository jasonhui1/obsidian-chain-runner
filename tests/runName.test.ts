import { describe, expect, it } from 'vitest'
import { formatTime, runDifferentiator, runName, runNameFromMeta } from '@/run/runName'
import type { RunMeta } from '@/engine/types'

describe('runDifferentiator', () => {
  it('prefers the candidate it was picked from', () => {
    expect(
      runDifferentiator({
        candidate: 'Meta-Architect',
        dropdownValue: 'engineers',
        group: { index: 1, count: 3 },
        startTime: '00:41',
      }),
    ).toBe('Meta-Architect (run 2 of 3)')
  })

  it('prefers the dropdown and disambiguates repeated group members', () => {
    expect(
      runDifferentiator({
        dropdownValue: 'engineers',
        group: { index: 1, count: 3 },
        startTime: '00:41',
      }),
    ).toBe('engineers (run 2 of 3)')
  })

  it('uses group place when no candidate or dropdown was picked', () => {
    expect(runDifferentiator({ group: { index: 1, count: 3 }, startTime: '00:41' })).toBe('run 2 of 3')
  })

  it('prefers dropdown value for a single run', () => {
    expect(
      runDifferentiator({
        dropdownValue: 'engineers',
        startTime: '00:41',
      }),
    ).toBe('engineers')
  })

  it('falls back to dropdown value when group has only 1 run', () => {
    expect(
      runDifferentiator({
        dropdownValue: 'engineers',
        group: { index: 0, count: 1 },
        startTime: '00:41',
      }),
    ).toBe('engineers')
  })

  it('falls back to start time when group has only 1 run and no dropdown', () => {
    expect(
      runDifferentiator({
        group: { index: 0, count: 1 },
        startTime: '00:41',
      }),
    ).toBe('00:41')
  })

  it('falls back to start time when no differentiator is declared', () => {
    expect(runDifferentiator({ startTime: '00:41' })).toBe('00:41')
  })
})

describe('formatTime', () => {
  it('preserves an existing HH:mm string', () => {
    expect(formatTime('00:41')).toBe('00:41')
  })

  it('formats a Date into 2-digit HH:mm', () => {
    const date = new Date(2026, 8, 23, 4, 7)
    expect(formatTime(date)).toBe('04:07')
  })

  it('formats a timestamp into 2-digit HH:mm', () => {
    const date = new Date(2026, 8, 23, 14, 55)
    expect(formatTime(date.getTime())).toBe('14:55')
  })

  it('formats an ISO timestamp in local time', () => {
    const iso = '2026-09-23T00:41:00Z'
    expect(formatTime(iso)).toBe(formatTime(new Date(iso)))
  })
})

describe('runName', () => {
  it('names runs as <chain> · <what makes this run different>', () => {
    expect(runName({ chainName: 'creative-director', candidate: 'Meta-Architect' })).toBe('creative-director · Meta-Architect')
    expect(runName({ chainName: 'five-personas', dropdownValue: 'engineers' })).toBe('five-personas · engineers')
    expect(runName({ chainName: 'five-personas', group: { index: 1, count: 3 } })).toBe('five-personas · run 2 of 3')
    expect(runName({ chainName: 'creative-director', startTime: '00:41' })).toBe('creative-director · 00:41')
  })
})

describe('runNameFromMeta', () => {
  const meta: RunMeta = {
    runId: '2026-09-23-Wgvfl8',
    chainName: 'creative-director',
    seedPrompt: 'prompt',
    startedAt: '00:41',
    status: 'complete',
    agentOutputs: [],
  }

  it('extracts start time from RunMeta', () => {
    expect(runNameFromMeta(meta)).toBe('creative-director · 00:41')
  })

  it('extracts parameter value from RunMeta', () => {
    const withParam: RunMeta = { ...meta, parameter: { name: 'role', value: 'engineers' } }
    expect(runNameFromMeta(withParam)).toBe('creative-director · engineers')
  })

  it('extracts variance group from RunMeta', () => {
    const withVariance: RunMeta = { ...meta, variance: { groupId: 'g1', index: 0, size: 3 } }
    expect(runNameFromMeta(withVariance)).toBe('creative-director · run 1 of 3')
  })

  it('extracts candidate from RunMeta holds', () => {
    const withHold: RunMeta = {
      ...meta,
      holds: [
        {
          nodeId: 'h1',
          input: '',
          candidates: [],
          reachedAt: '',
          chosen: 'Meta-Architect',
        },
      ],
    }
    expect(runNameFromMeta(withHold)).toBe('creative-director · Meta-Architect')
  })

  it('accepts explicit overrides', () => {
    expect(runNameFromMeta(meta, { candidate: 'Custom-Pick' })).toBe('creative-director · Custom-Pick')
  })

  it('names a fork for the candidate chosen at its branch hold', () => {
    const fork: RunMeta = {
      ...meta,
      branchedFromNode: 'first',
      holds: [
        { nodeId: 'first', input: '', candidates: [], reachedAt: '', chosen: 'Meta-Architect' },
        { nodeId: 'later', input: '', candidates: [], reachedAt: '', chosen: 'Another idea' },
      ],
    }
    expect(runNameFromMeta(fork)).toBe('creative-director · Meta-Architect')
  })
})
