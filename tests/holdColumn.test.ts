import { describe, expect, it } from 'vitest'
import { beforeHoldRow, buildHoldColumn, buildPickRow, candidateWords, freshCustomCard, holdStamp, pickRowBoxes, pickStamp, stampHold, stampPick, waitingFrameBox } from '@/ui/holdColumn'
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
    expect(column.custom.continueAt.y).toBeGreaterThan(column.custom.y)
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

  it('keeps an earlier taller hold column inside the frame after another hold arrives', () => {
    const frame = { x: 100, y: 50, width: 500, height: 900 }
    const tall = { x: 200, y: 82, width: 360, height: 800 }
    const short = { x: 584, y: 82, width: 360, height: 300 }
    const resized = waitingFrameBox(frame, [], [tall, short])
    expect(resized.height).toBeGreaterThanOrEqual(tall.y + tall.height - frame.y)
    expect(resized.width).toBeGreaterThanOrEqual(short.x + short.width - frame.x)
  })

  it('keeps the engine heading, run, node and revision in the click stamp', () => {
    const stamp = { runId: 'run-1', nodeId: hold.nodeId, heading: 'Candidate 1', revision: 3, role: 'candidate' as const }
    expect(holdStamp({ customData: stampHold(stamp) })).toEqual(stamp)
    expect(holdStamp({ customData: stampHold({ ...stamp, role: 'continue' }) })?.role).toBe('continue')
    expect(candidateWords('Candidate 1', 'The Guidebook Lie\nA complete first idea.')).not.toContain('Candidate 1')
  })

  it('places small output previews beside the chosen slot and stamps their row', () => {
    const slot = buildHoldColumn(hold, 500, 100).candidates[1]!.box
    const cards = pickRowBoxes(slot, 2)
    expect(cards).toEqual([
      { x: slot.x + slot.width + 24, y: slot.y, width: 320, height: 160 },
      { x: slot.x + slot.width + 368, y: slot.y, width: 320, height: 160 },
    ])
    const stamp = { runId: 'run-1', nodeId: hold.nodeId, heading: 'Echoes of the Fallen' }
    expect(pickStamp({ customData: stampPick(stamp) })).toEqual(stamp)
    const row = buildPickRow(slot, 2)
    expect(row.cards.map(one => one.box)).toEqual(cards)
    expect(row.cards[0]!.length.y).toBeLessThan(cards[0]!.y + cards[0]!.height)
    expect(row.direct.x).toBeGreaterThan(cards[1]!.x + cards[1]!.width)
    expect(row.right).toBeGreaterThan(row.direct.x)
  })

  it('places a reroll affordance at the foot of the column only while the hold is open and reroll is advertised', () => {
    const columnWithout = buildHoldColumn(hold, 500, 100)
    expect(columnWithout.rerollAt).toBeUndefined()

    const columnWith = buildHoldColumn(hold, 500, 100, { canReroll: true })
    expect(columnWith.rerollAt).toBeDefined()
    expect(columnWith.rerollAt!.x).toBe(columnWith.custom.x)
    expect(columnWith.rerollAt!.y).toBeGreaterThan(columnWith.custom.y + columnWith.custom.height)
    expect(columnWith.box.height).toBeGreaterThan(columnWithout.box.height)

    const answered = { ...hold, chosen: 'Candidate 1' }
    expect(buildHoldColumn(answered, 500, 100, { canReroll: true }).rerollAt).toBeUndefined()

    const resolved = { ...hold, resolvedAt: 'now' }
    expect(buildHoldColumn(resolved, 500, 100, { canReroll: true }).rerollAt).toBeUndefined()

    const stamp = { runId: 'run-1', nodeId: hold.nodeId, heading: '', revision: 3, role: 'reroll' as const }
    expect(holdStamp({ customData: stampHold(stamp) })).toEqual(stamp)
  })

  it('places a fresh empty custom card below the picked candidate with its own continue line', () => {
    const candidate = { x: 200, y: 300, width: 320, height: 124 }
    const fresh = freshCustomCard(candidate)
    expect(fresh.box.x).toBe(candidate.x)
    expect(fresh.box.y).toBe(candidate.y + 160 + 12)
    expect(fresh.box.width).toBe(candidate.width)
    expect(fresh.containerHeight).toBe(124)
    expect(fresh.continueAt).toEqual({ x: candidate.x + 16, y: fresh.box.y + 124 })
    expect(fresh.columnBottom).toBe(fresh.continueAt.y + 28 + 16)
  })
})

