import { describe, it, expect } from 'vitest'
import { arrangeRun, type Arrangement } from '@/ui/arrangement'
import type { RunLayout, RunPanel } from '@/run/panels'
import type { LayoutKind } from '@/engine/types'

/**
 * The arrangement is the one thing about a layout the view still decides: not
 * what the panels are — the engine settled that (ADR-0001) — but where they go.
 * It is a pure function so all three shapes are checkable without a vault.
 */

function panel(over: Partial<RunPanel> = {}): RunPanel {
  return { name: 'hop 1', node: 'first', text: '', lines: 0, state: 'pending', ...over }
}

const layout = (kind: LayoutKind, panels: RunPanel[]): RunLayout => ({ kind, panels })

function columnsOf(arrangement: Arrangement) {
  if (arrangement.kind !== 'columns') throw new Error(`expected columns, got ${arrangement.kind}`)
  return arrangement.columns
}

function sidebarOf(arrangement: Arrangement) {
  if (arrangement.kind !== 'sidebar') throw new Error(`expected sidebar, got ${arrangement.kind}`)
  return arrangement
}

describe('arrangeRun: a timeline stacks', () => {
  it('keeps the engine order, top to bottom', () => {
    const panels = [panel({ name: 'hop 1' }), panel({ name: 'skeleton', node: 'second', emphasis: 'last' })]
    const arrangement = arrangeRun(layout('timeline', panels))
    expect(arrangement.kind).toBe('stack')
    expect(arrangement.kind === 'stack' && arrangement.panels).toEqual(panels)
  })

  it('stacks the trace fallback too — an undeclared chain has no shape to honour', () => {
    expect(arrangeRun(layout('undeclared', [panel()])).kind).toBe('stack')
  })
})

describe('arrangeRun: columns', () => {
  const branches = [
    panel({ name: 'left', node: 'a' }),
    panel({ name: 'right', node: 'b' }),
    panel({ name: 'together', node: 'join', emphasis: 'join' }),
  ]

  it('gives every panel its own column, in the declared order', () => {
    expect(columnsOf(arrangeRun(layout('columns', branches))).map(column => column.panel.name)).toEqual([
      'left',
      'right',
      'together',
    ])
  })

  it('widens the converging panel and nothing else', () => {
    expect(columnsOf(arrangeRun(layout('columns', branches))).map(column => column.wide)).toEqual([
      false,
      false,
      true,
    ])
  })

  it('takes the emphasis from the engine rather than the position', () => {
    const joinFirst = [panel({ name: 'together', node: 'join', emphasis: 'join' }), panel({ name: 'left', node: 'a' })]
    expect(columnsOf(arrangeRun(layout('columns', joinFirst))).map(column => column.wide)).toEqual([true, false])
  })

  it('leaves a columns chain with no join panel with no wide column', () => {
    const noJoin = [panel({ name: 'left', node: 'a' }), panel({ name: 'right', node: 'b', emphasis: 'last' })]
    expect(columnsOf(arrangeRun(layout('columns', noJoin))).every(column => !column.wide)).toBe(true)
  })
})

describe('arrangeRun: a sidebar of rounds', () => {
  const rounds = [
    panel({ name: 'round 1', node: 'body', round: 0, state: 'filled', text: 'first pass', lines: 1 }),
    panel({ name: 'round 2', node: 'body', round: 1, state: 'filled', text: 'second pass', lines: 1 }),
    panel({ name: 'round 3', node: 'body', round: 2 }),
  ]

  it('lists every panel as a round, in the engine order', () => {
    expect(sidebarOf(arrangeRun(layout('sidebar', rounds))).rounds.map(entry => entry.panel.name)).toEqual([
      'round 1',
      'round 2',
      'round 3',
    ])
  })

  it('follows the run: the latest round that has landed is the one in detail', () => {
    const arrangement = sidebarOf(arrangeRun(layout('sidebar', rounds)))
    expect(arrangement.detail?.name).toBe('round 2')
    expect(arrangement.rounds.map(entry => entry.selected)).toEqual([false, true, false])
  })

  it('prefers the round being written to the last one that settled', () => {
    const writing = [rounds[0], rounds[1], panel({ name: 'round 3', node: 'body', round: 2, streaming: 'half a sen' })]
    expect(sidebarOf(arrangeRun(layout('sidebar', writing))).detail?.name).toBe('round 3')
  })

  it('shows the first round before anything has landed, rather than nothing', () => {
    const waiting = [panel({ name: 'round 1', round: 0 }), panel({ name: 'round 2', round: 1 })]
    expect(sidebarOf(arrangeRun(layout('sidebar', waiting))).detail?.name).toBe('round 1')
  })

  it("honours the reader's pick over the run's own progress", () => {
    const arrangement = sidebarOf(arrangeRun(layout('sidebar', rounds), 0))
    expect(arrangement.detail?.name).toBe('round 1')
    expect(arrangement.rounds.map(entry => entry.selected)).toEqual([true, false, false])
  })

  it('falls back to following the run when the pick is out of range', () => {
    expect(sidebarOf(arrangeRun(layout('sidebar', rounds), 7)).detail?.name).toBe('round 2')
  })

  it('carries the round number the panel was tagged with, for the label', () => {
    expect(sidebarOf(arrangeRun(layout('sidebar', rounds))).rounds.map(entry => entry.round)).toEqual([0, 1, 2])
  })

  it('has nothing in detail when the run has produced no panels at all', () => {
    const arrangement = sidebarOf(arrangeRun(layout('sidebar', [])))
    expect(arrangement.rounds).toEqual([])
    expect(arrangement.detail).toBeUndefined()
  })
})
