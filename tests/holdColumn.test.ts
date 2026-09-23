import { describe, expect, it } from 'vitest'
import { beforeHoldRow, buildHoldColumn, candidateWords, holdStamp, stampHold } from '@/ui/holdColumn'
import type { HoldRecord } from '@/engine/types'
import type { RunFrame } from '@/run/runFrame'

const hold: HoldRecord = {
  nodeId: 'hold-idea',
  prompt: 'Pick the next direction',
  input: '',
  reachedAt: 'now',
  revision: 3,
  candidates: [
    { heading: 'Candidate 1', body: 'The Guidebook Lie\nA complete first idea.' },
    { heading: 'Echoes of the Fallen', body: 'A short second idea.' },
  ],
}

describe('a waiting hold column', () => {
  it('shows the whole candidate text and reserves at least an output card for every slot', () => {
    const column = buildHoldColumn(hold, 500, 100)
    expect(column.prompt.text).toContain('Pick the next direction')
    expect(column.candidates.map(candidate => candidate.text)).toEqual([
      'The Guidebook Lie\nA complete first idea.',
      'Echoes of the Fallen\nA short second idea.',
    ])
    expect(column.candidates.every(candidate => candidate.box.height >= 160)).toBe(true)
    expect(column.candidates[1]!.box.y).toBeGreaterThan(column.candidates[0]!.box.y + column.candidates[0]!.box.height)
    expect(column.custom.y).toBeGreaterThan(column.candidates[1]!.box.y + column.candidates[1]!.box.height)
  })

  it('gives long text a taller fixed slot before any pick is drawn', () => {
    const long = { ...hold, candidates: [{ heading: 'Candidate 1', body: 'a long idea '.repeat(100) }] }
    const column = buildHoldColumn(long, 0, 0)
    expect(column.candidates[0]!.box.height).toBeGreaterThan(160)
    expect(column.box.height).toBeGreaterThan(column.custom.height + column.candidates[0]!.box.height)
  })

  it('keeps reached panels in their engine order as one row ahead of the column', () => {
    const frame: RunFrame = {
      runId: 'run-1', name: 'chain · run-1',
      box: { x: 100, y: 50, width: 700, height: 400 },
      panels: [
        { index: 0, panel: { name: 'first', node: 'a', text: '', lines: 0, state: 'filled' }, box: { x: 100, y: 290, width: 160, height: 240 }, emphasis: false },
        { index: 2, panel: { name: 'later', node: 'c', text: '', lines: 0, state: 'pending' }, box: { x: 420, y: 290, width: 160, height: 240 }, emphasis: false },
        { index: 1, panel: { name: 'second', node: 'b', text: '', lines: 0, state: 'filled' }, box: { x: 260, y: 80, width: 160, height: 240 }, emphasis: false },
      ],
    }
    expect(beforeHoldRow(frame, [2])).toEqual([
      { index: 0, box: { x: 132, y: 82, width: 160, height: 240 } },
      { index: 1, box: { x: 316, y: 82, width: 160, height: 240 } },
    ])
  })

  it('keeps the engine heading, run, node and revision in the click stamp', () => {
    const stamp = { runId: 'run-1', nodeId: hold.nodeId, heading: 'Candidate 1', revision: 3, role: 'candidate' as const }
    expect(holdStamp({ customData: stampHold(stamp) })).toEqual(stamp)
    expect(holdStamp({ customData: stampHold({ ...stamp, role: 'continue' }) })?.role).toBe('continue')
    expect(candidateWords('Candidate 1', 'The Guidebook Lie\nA complete first idea.')).not.toContain('Candidate 1')
  })
})
