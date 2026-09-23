import { describe, it, expect } from 'vitest'
import { buildRunFrame, waitingRunFrameName } from '@/run/runFrame'
import type { RunLayout, RunPanel } from '@/run/panels'
import type { Box } from '@/ui/nodeScene'

/** Where a run's outputs land: layout plus node position in, coordinates out. */

const node: Box = { x: 100, y: 200, width: 300, height: 140 }

const panel = (name: string, over: Partial<RunPanel> = {}): RunPanel => ({
  name,
  node: name.toLowerCase(),
  text: name,
  lines: 1,
  state: 'filled',
  ...over,
})

const frameOf = (layout: RunLayout): ReturnType<typeof buildRunFrame> =>
  buildRunFrame({ layout, chainName: 'Five Personas', runId: '2026-09-02-ab12c', node })

/** Everything the frame holds, as `name → box`. */
const boxes = (frame: ReturnType<typeof buildRunFrame>): Record<string, Box> =>
  Object.fromEntries(frame.panels.map(one => [one.panel.name, one.box]))

describe('buildRunFrame', () => {
  it('titles a waiting frame without exposing the run id', () => {
    expect(waitingRunFrameName('Five Personas · run-1', 'run-1')).toBe('Five Personas · waiting')
  })
  it('titles the frame with the chain and the run', () => {
    expect(frameOf({ kind: 'timeline', panels: [panel('Draft')] }).name).toBe('Five Personas · 2026-09-02-ab12c')
  })

  it('puts the frame beside the node, top-aligned with it', () => {
    const frame = frameOf({ kind: 'timeline', panels: [panel('Draft')] })
    expect(frame.box.x).toBeGreaterThan(node.x + node.width)
    expect(frame.box.y).toBe(node.y)
  })

  it('keeps every panel inside the frame', () => {
    const frame = frameOf({
      kind: 'columns',
      panels: [panel('Optimist'), panel('Skeptic'), panel('Synthesis', { emphasis: 'join' })],
    })
    for (const { box } of frame.panels) {
      expect(box.x).toBeGreaterThanOrEqual(frame.box.x)
      expect(box.y).toBeGreaterThanOrEqual(frame.box.y)
      expect(box.x + box.width).toBeLessThanOrEqual(frame.box.x + frame.box.width)
      expect(box.y + box.height).toBeLessThanOrEqual(frame.box.y + frame.box.height)
    }
  })

  describe('columns', () => {
    const layout: RunLayout = {
      kind: 'columns',
      panels: [
        panel('Optimist'),
        panel('Skeptic'),
        panel('Cynic'),
        panel('Synthesis', { emphasis: 'join' }),
      ],
    }

    it('sets the branches side by side on one row', () => {
      const placed = boxes(frameOf(layout))
      expect(placed.Optimist.y).toBe(placed.Skeptic.y)
      expect(placed.Skeptic.y).toBe(placed.Cynic.y)
      expect(placed.Optimist.x).toBeLessThan(placed.Skeptic.x)
      expect(placed.Skeptic.x).toBeLessThan(placed.Cynic.x)
      expect(placed.Optimist.width).toBe(placed.Cynic.width)
    })

    it('puts the converging panel below the branches, wider and centred', () => {
      const placed = boxes(frameOf(layout))
      expect(placed.Synthesis.y).toBeGreaterThan(placed.Optimist.y + placed.Optimist.height)
      expect(placed.Synthesis.width).toBeGreaterThan(placed.Optimist.width)
      const branchesCentre = (placed.Optimist.x + placed.Cynic.x + placed.Cynic.width) / 2
      expect(placed.Synthesis.x + placed.Synthesis.width / 2).toBeCloseTo(branchesCentre)
    })

    it('emphasises the converging panel and nothing else', () => {
      const emphasised = frameOf(layout).panels.filter(one => one.emphasis)
      expect(emphasised.map(one => one.panel.name)).toEqual(['Synthesis'])
    })

    it('is one row when the chain declares no join', () => {
      const frame = frameOf({ kind: 'columns', panels: [panel('Optimist'), panel('Skeptic')] })
      const placed = boxes(frame)
      expect(placed.Optimist.y).toBe(placed.Skeptic.y)
      expect(frame.panels.some(one => one.emphasis)).toBe(false)
    })
  })

  describe('timeline', () => {
    const layout: RunLayout = {
      kind: 'timeline',
      panels: [panel('First'), panel('Second'), panel('Survivor', { emphasis: 'last' })],
    }

    it('lays the hops out in one row, each narrower than the last', () => {
      const placed = boxes(frameOf(layout))
      expect(placed.First.y).toBe(placed.Second.y)
      expect(placed.Second.y).toBe(placed.Survivor.y)
      expect(placed.Second.width).toBeLessThan(placed.First.width)
      expect(placed.Survivor.width).toBeLessThan(placed.Second.width)
      expect(placed.First.x).toBeLessThan(placed.Second.x)
      expect(placed.Second.x).toBeLessThan(placed.Survivor.x)
    })

    it('never narrows a hop past reading width', () => {
      const long = { kind: 'timeline' as const, panels: Array.from({ length: 20 }, (_, i) => panel(`Hop ${i}`)) }
      for (const { box } of frameOf(long).panels) expect(box.width).toBeGreaterThanOrEqual(160)
    })

    it('emphasises the survivor the engine marked', () => {
      expect(frameOf(layout).panels.map(one => one.emphasis)).toEqual([false, false, true])
    })

    it('emphasises the final panel when the layout marks none', () => {
      const frame = frameOf({ kind: 'undeclared', panels: [panel('First'), panel('Second')] })
      expect(frame.panels.map(one => one.emphasis)).toEqual([false, true])
    })
  })

  it('remembers where each panel sat in the engine’s order, however it is drawn', () => {
    // Branches are drawn first whatever order the ports were declared in.
    const frame = frameOf({
      kind: 'columns',
      panels: [panel('Synthesis', { emphasis: 'join' }), panel('Optimist'), panel('Skeptic')],
    })
    expect(frame.panels.map(one => one.panel.name)).toEqual(['Optimist', 'Skeptic', 'Synthesis'])
    expect(frame.panels.map(one => one.index)).toEqual([1, 2, 0])
  })

  it('lays a sidebar layout’s rounds out as equal peers, not as a relay', () => {
    const frame = frameOf({ kind: 'sidebar', panels: [panel('Round 1'), panel('Round 2'), panel('Round 3')] })
    const widths = frame.panels.map(one => one.box.width)
    expect(new Set(widths).size).toBe(1)
    expect(frame.panels.map(one => one.box.y)).toEqual([frame.panels[0].box.y, frame.panels[0].box.y, frame.panels[0].box.y])
  })

  it('holds nothing for a run with no panels', () => {
    const frame = frameOf({ kind: 'timeline', panels: [] })
    expect(frame.panels).toEqual([])
    expect(frame.box.width).toBeGreaterThan(0)
  })
})
