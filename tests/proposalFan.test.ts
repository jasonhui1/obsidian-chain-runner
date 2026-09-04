import { describe, it, expect } from 'vitest'
import { buildProposalFan } from '@/ui/proposalFan'
import { buildProposalLabels } from '@/ui/proposal'
import type { RunLayout, RunPanel } from '@/run/panels'
import type { Box } from '@/ui/nodeScene'

/** Where an expansion's proposals land: the source block's box in, coordinates out. */

const source: Box = { x: 100, y: 200, width: 240, height: 80 }

const panel = (name: string, over: Partial<RunPanel> = {}): RunPanel => ({
  name,
  node: name.toLowerCase(),
  text: name,
  lines: 1,
  state: 'filled',
  ...over,
})

const fanOf = (layout: RunLayout, from: Box = source): ReturnType<typeof buildProposalFan> =>
  buildProposalFan({ layout, source: from })

const identity = { proposalId: 'p-1', chainName: 'c', runId: 'r', notePath: 'n.md' }

const three: RunLayout = {
  kind: 'columns',
  panels: [panel('Optimist'), panel('Skeptic'), panel('Where they collide', { emphasis: 'join' })],
}

describe('buildProposalFan', () => {
  it('has nothing to place for a run with no panels', () => {
    expect(fanOf({ kind: 'timeline', panels: [] })).toEqual([])
  })

  it('keeps one proposal per panel, in the engine`s order', () => {
    const fan = fanOf(three)
    expect(fan.map(one => one.panel.name)).toEqual(['Optimist', 'Skeptic', 'Where they collide'])
    expect(fan.map(one => one.index)).toEqual([0, 1, 2])
  })

  it('puts every proposal clear of the source block', () => {
    for (const { box } of fanOf(three)) {
      expect(box.x).toBeGreaterThan(source.x + source.width)
    }
  })

  it('stacks them down the page without overlapping', () => {
    const boxes = fanOf(three).map(one => one.box)
    for (let i = 1; i < boxes.length; i++) {
      const above = boxes[i - 1]!
      const below = boxes[i]!
      expect(below.y).toBeGreaterThanOrEqual(above.y + above.height)
    }
  })

  it('leaves each card room for its own labels', () => {
    const boxes = fanOf(three).map(one => one.box)
    for (let i = 1; i < boxes.length; i++) {
      const above = boxes[i - 1]!
      for (const label of buildProposalLabels(above, identity)) {
        expect(label.y + label.height).toBeLessThanOrEqual(boxes[i]!.y)
      }
    }
  })

  it('gives every proposal the same box', () => {
    const boxes = fanOf(three).map(one => one.box)
    expect(new Set(boxes.map(box => `${box.width}x${box.height}`)).size).toBe(1)
  })

  it('centres the column on the middle of the source', () => {
    const boxes = fanOf(three).map(one => one.box)
    const first = boxes[0]!
    const last = boxes[boxes.length - 1]!
    const middle = (first.y + last.y + last.height) / 2
    expect(middle).toBeCloseTo(source.y + source.height / 2, 6)
  })

  it('puts a lone proposal level with the source', () => {
    const [only] = fanOf({ kind: 'timeline', panels: [panel('Only')] })
    expect(only!.box.y + only!.box.height / 2).toBeCloseTo(source.y + source.height / 2, 6)
  })

  it('moves with the block it came from', () => {
    const here = fanOf(three).map(one => one.box)
    const there = fanOf(three, { ...source, x: source.x + 500, y: source.y + 300 }).map(one => one.box)
    for (let i = 0; i < here.length; i++) {
      expect(there[i]!.x - here[i]!.x).toBe(500)
      expect(there[i]!.y - here[i]!.y).toBe(300)
    }
  })
})
