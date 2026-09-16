import type { RunLayout, RunPanel } from './panels'
import type { Box } from '../ui/nodeScene'

/** Initial placement for a run's outputs. The engine decides what the panels are (ADR-0001). */

/** One output, and the rectangle its embeddable is placed in. */
export interface FramedPanel {
  panel: RunPanel
  /** Its position in the engine's order, which `columns` does not draw in. */
  index: number
  box: Box
  /** A columns chain's converging panel, or a relay's survivor. Drawn heavier. */
  emphasis: boolean
}

/** A run's outputs, as a frame holding placed panels. */
export interface RunFrame {
  name: string
  runId: string
  box: Box
  panels: FramedPanel[]
}

const PANEL_WIDTH = 320
const PANEL_HEIGHT = 240
const JOIN_WIDTH = 480
const GAP = 24
/** Room inside the frame around its panels. */
export const FRAME_PADDING = 32
/** Between the node and the frame its run produced. */
const NODE_GAP = 80

/** How much of the previous panel's width each hop of a relay keeps. */
const SHRINK = 0.82
/** Below this a panel is a sliver rather than something to read. */
const MIN_WIDTH = 160

/** The frame for a run, to the right of the node that produced it and top-aligned with it. */
export function buildRunFrame(input: {
  layout: RunLayout
  chainName: string
  runId: string
  node: Box
}): RunFrame {
  const { layout, chainName, runId, node } = input
  const placed = arrange(layout)

  const origin = { x: node.x + node.width + NODE_GAP, y: node.y }
  const bounds = extent(placed.map(one => one.box))

  return {
    name: `${chainName} · ${runId}`,
    runId,
    box: {
      x: origin.x,
      y: origin.y,
      width: bounds.width + FRAME_PADDING * 2,
      height: bounds.height + FRAME_PADDING * 2,
    },
    // Arranged from zero, then moved as a set.
    panels: placed.map(one => ({
      ...one,
      box: {
        ...one.box,
        x: one.box.x - bounds.x + origin.x + FRAME_PADDING,
        y: one.box.y - bounds.y + origin.y + FRAME_PADDING,
      },
    })),
  }
}

/** `sidebar` is a loop's rounds, which are peers, so they get an even row. */
function arrange(layout: RunLayout): FramedPanel[] {
  const panels = layout.panels.map((panel, index) => ({ panel, index }))
  switch (layout.kind) {
    case 'columns':
      return columns(panels)
    case 'sidebar':
      return row(panels, PANEL_WIDTH, 0, 0).placed
    case 'timeline':
    case 'undeclared':
      return shrinkingRow(panels)
    default: {
      // Fails to compile when `LayoutKind` gains a member (ADR-0001).
      const unknown: never = layout.kind
      return unknown
    }
  }
}

interface Ordered {
  panel: RunPanel
  index: number
}

/** Branches in a row, and the panel they converge on centred beneath them, wider. */
function columns(panels: Ordered[]): FramedPanel[] {
  const branches = panels.filter(one => one.panel.emphasis !== 'join')
  const joins = panels.filter(one => one.panel.emphasis === 'join')
  if (branches.length === 0) return row(joins, JOIN_WIDTH, 0, 0).placed

  const top = row(branches, PANEL_WIDTH, 0, 0)
  if (joins.length === 0) return top.placed

  const below = row(joins, JOIN_WIDTH, 0, PANEL_HEIGHT + GAP * 2)
  const shift = (top.width - below.width) / 2
  return [
    ...top.placed,
    ...below.placed.map(one => ({ ...one, box: { ...one.box, x: one.box.x + shift } })),
  ]
}

function row(panels: Ordered[], width: number, x: number, y: number): { placed: FramedPanel[]; width: number } {
  let left = x
  const placed = panels.map(({ panel, index }) => {
    const box = { x: left, y, width, height: PANEL_HEIGHT }
    left += width + GAP
    return { panel, index, box, emphasis: panel.emphasis === 'join' }
  })
  return { placed, width: Math.max(0, left - x - GAP) }
}

/**
 * A relay: a row that narrows hop by hop, ending on the survivor the engine
 * marked `last`. A layout that marks none emphasises its final panel.
 */
function shrinkingRow(panels: Ordered[]): FramedPanel[] {
  const declared = panels.some(one => one.panel.emphasis !== undefined)
  let left = 0
  return panels.map(({ panel, index }, along) => {
    const width = Math.max(MIN_WIDTH, Math.round(PANEL_WIDTH * SHRINK ** along))
    const box = { x: left, y: 0, width, height: PANEL_HEIGHT }
    left += width + GAP
    return {
      panel,
      index,
      box,
      emphasis: declared ? panel.emphasis === 'last' : along === panels.length - 1,
    }
  })
}

function extent(boxes: Box[]): Box {
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  const x = Math.min(...boxes.map(box => box.x))
  const y = Math.min(...boxes.map(box => box.y))
  return {
    x,
    y,
    width: Math.max(...boxes.map(box => box.x + box.width)) - x,
    height: Math.max(...boxes.map(box => box.y + box.height)) - y,
  }
}
