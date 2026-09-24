import { describe, expect, it } from 'vitest'
import { answeredWith, beforeHoldRow, buildHoldColumn, buildPickRow, candidateWords, holdStamp, nextOwnWordsCard, pickRowBoxes, pickStamp, stampHold, stampPick, typedWords, waitingFrameBox } from '@/ui/holdColumn'
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
    expect(column.ownWords.box.y).toBeGreaterThan(column.candidates[1]!.box.y + column.candidates[1]!.box.height)
    expect(column.ownWords.continueAt.y).toBe(column.ownWords.box.y + column.ownWords.box.height)
  })

  it('gives long text a taller fixed slot before any pick is drawn', () => {
    const long = { ...hold, candidates: [{ heading: 'Candidate 1', body: 'a long idea '.repeat(100) }] }
    const column = buildHoldColumn(long, 0, 0)
    expect(column.candidates[0]!.box.height).toBeGreaterThan(160)
    expect(column.box.height).toBeGreaterThan(column.ownWords.box.height + column.candidates[0]!.box.height)
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
    expect(columnWith.rerollAt!.x).toBe(columnWith.ownWords.box.x)
    expect(columnWith.rerollAt!.y).toBeGreaterThan(columnWith.ownWords.bottom)
    expect(columnWith.box.height).toBeGreaterThan(columnWithout.box.height)

    const answered = { ...hold, chosen: 'Candidate 1' }
    expect(buildHoldColumn(answered, 500, 100, { canReroll: true }).rerollAt).toBeUndefined()

    const resolved = { ...hold, resolvedAt: 'now' }
    expect(buildHoldColumn(resolved, 500, 100, { canReroll: true }).rerollAt).toBeUndefined()

    const stamp = { runId: 'run-1', nodeId: hold.nodeId, heading: '', revision: 3, role: 'reroll' as const }
    expect(holdStamp({ customData: stampHold(stamp) })).toEqual(stamp)
  })

  it('places the next own-words card below the used one and its pick row, with its own continue line', () => {
    const used = { x: 200, y: 300, width: 328, height: 124 }
    const next = nextOwnWordsCard(used)
    expect(next.box).toEqual({ x: used.x, y: used.y + 160 + 12, width: used.width, height: 124 })
    expect(next.continueAt).toEqual({ x: used.x + 16, y: next.box.y + 124 })
    expect(next.columnBottom).toBe(next.bottom + 16)
  })

  it('lays out the column’s own-words card the same way as the next one', () => {
    const { ownWords } = buildHoldColumn(hold, 500, 100)
    const next = nextOwnWordsCard(ownWords.box)
    expect(next.box.height).toBe(ownWords.box.height)
    expect(next.bottom - next.box.y).toBe(ownWords.bottom - ownWords.box.y)
  })

  it('reads the reader’s words without the placeholder they may have typed after', () => {
    expect(typedWords('✎ Your own')).toBe('')
    expect(typedWords('  ✎ Your own  \n A theme park. ')).toBe('A theme park.')
    expect(typedWords('A theme park.\nWith rollercoasters.')).toBe('A theme park.\nWith rollercoasters.')
  })

  it('names a pick row by the candidate, or by the first line of the reader’s own words', () => {
    expect(answeredWith({ chosen: 'Candidate 2' })).toEqual({ heading: 'Candidate 2' })
    expect(answeredWith({ custom: 'A theme park.\nWith rollercoasters.' }))
      .toEqual({ heading: 'A theme park.', words: 'A theme park.\nWith rollercoasters.' })
    expect(answeredWith({ custom: '   ' })).toEqual({ heading: 'Your own words', words: '   ' })
    expect(answeredWith({})).toBeUndefined()
  })
})

