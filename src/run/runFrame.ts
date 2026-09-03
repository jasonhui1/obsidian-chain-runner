import type { RunLayout, RunPanel } from './panels'
import type { Box } from '../ui/nodeScene'

/**
 * Where a run's outputs go on the drawing.
 *
 * The engine says what the panels *are* (ADR-0001); this says where each one is
 * put the first time. Two arrangements, because the two layouts the engine
 * declares read differently: a `columns` chain fans out and converges, so its
 * branches sit side by side with the panel they were run to produce beneath
 * them; anything else is a relay, and reads as a row that narrows hop by hop
 * with the survivor at the end.
 *
 * Placement is initial only. The frame and its embeddables are ordinary
 * Excalidraw elements from the moment they land, and the reader owns them —
 * dragging one out of the frame is a thing they are allowed to do, and nothing
 * here ever puts it back.
 */

/** One output, and the rectangle its embeddable is placed in. */
export interface FramedPanel {
  panel: RunPanel
  box: Box
  /**
   * The panel the layout is *about* — a columns chain's converging panel, a
   * relay's survivor. Drawn with a heavier stroke, so the shape of the run reads
   * from across the canvas.
   */
  emphasis: boolean
}

/** A run's outputs, as a frame holding placed panels. */
export interface RunFrame {
  /** The frame's title: the chain, and the run this was. */
  name: string
  box: Box
  panels: FramedPanel[]
}

/** An embeddable's size. Wide enough to read a paragraph of prose in. */
const PANEL_WIDTH = 320
const PANEL_HEIGHT = 240
/** The converging panel of a columns chain, which is the one worth reading first. */
const JOIN_WIDTH = 480
const GAP = 24
/** Room inside the frame around its panels. */
const PADDING = 32
/** Between the node and the frame its run produced. */
const NODE_GAP = 80

/** How much of the previous panel's width each hop of a relay keeps. */
const SHRINK = 0.82
/** Below this a panel is a sliver rather than something to read; the row stops narrowing. */
const MIN_WIDTH = 160

/**
 * The frame for a run, positioned against the node that produced it.
 *
 * The frame goes to the right of the node, top-aligned with it: the node is the
 * thing the reader clicked and the outputs are what came of it, so they read in
 * that order, and nothing lands on top of whatever is above or below the node.
 */
export function buildRunFrame(input: {
  layout: RunLayout
  chainName: string
  runId: string
  /** Where the node sits, from `nodeBox`. */
  node: Box
}): RunFrame {
  const { layout, chainName, runId, node } = input
  const placed = arrange(layout)

  const origin = { x: node.x + node.width + NODE_GAP, y: node.y }
  const bounds = extent(placed.map(one => one.box))

  return {
    name: `${chainName} · ${runId}`,
    box: {
      x: origin.x,
      y: origin.y,
      width: bounds.width + PADDING * 2,
      height: bounds.height + PADDING * 2,
    },
    // The panels are laid out from zero and moved as a set, so an arrangement
    // never has to know where on the canvas it ended up.
    panels: placed.map(one => ({
      ...one,
      box: {
        ...one.box,
        x: one.box.x - bounds.x + origin.x + PADDING,
        y: one.box.y - bounds.y + origin.y + PADDING,
      },
    })),
  }
}

/**
 * Which of the three pictures a layout gets.
 *
 * `sidebar` is a loop's rounds, and rounds are peers: they get an even row
 * rather than a narrowing one, because nothing is handed on and narrowed. Naming
 * all four kinds here rather than falling through to the relay is what keeps a
 * kind the engine adds later from silently getting a picture that is wrong for
 * it (ADR-0001).
 */
function arrange(layout: RunLayout): FramedPanel[] {
  if (layout.kind === 'columns') return columns(layout.panels)
  if (layout.kind === 'sidebar') return row(layout.panels, PANEL_WIDTH, 0, 0).placed
  return shrinkingRow(layout.panels)
}

/**
 * A columns chain: the branches in a row, and the panel they converge on
 * centred beneath them, wider.
 *
 * A chain that declares no join is just the row — and one that is *only* a join
 * is one wide panel, which is the degenerate case of the same picture.
 */
function columns(panels: RunPanel[]): FramedPanel[] {
  const branches = panels.filter(panel => panel.emphasis !== 'join')
  const joins = panels.filter(panel => panel.emphasis === 'join')
  if (branches.length === 0) return row(joins, JOIN_WIDTH, 0, 0).placed

  const top = row(branches, PANEL_WIDTH, 0, 0)
  if (joins.length === 0) return top.placed

  const below = row(joins, JOIN_WIDTH, 0, PANEL_HEIGHT + GAP * 2)
  // Centred under the branches, which is what makes the row above read as
  // feeding it rather than as a second, unrelated row.
  const shift = (top.width - below.width) / 2
  return [
    ...top.placed,
    ...below.placed.map(one => ({ ...one, box: { ...one.box, x: one.box.x + shift } })),
  ]
}

/** One row of equal panels, left to right. */
function row(panels: RunPanel[], width: number, x: number, y: number): { placed: FramedPanel[]; width: number } {
  let left = x
  const placed = panels.map(panel => {
    const box = { x: left, y, width, height: PANEL_HEIGHT }
    left += width + GAP
    return { panel, box, emphasis: panel.emphasis === 'join' }
  })
  return { placed, width: Math.max(0, left - x - GAP) }
}

/**
 * A relay: a row that narrows hop by hop, ending on the survivor.
 *
 * The narrowing is the picture of what a relay does — each hop hands on less
 * than it was given — and it stops at `MIN_WIDTH` so a long chain ends in
 * something still readable rather than in a stack of slivers.
 *
 * The engine marks the survivor with `emphasis: 'last'`. A layout that marks
 * none — the trace fallback for a chain that declares no view — emphasises its
 * final panel, which is the same panel by a weaker rule.
 */
function shrinkingRow(panels: RunPanel[]): FramedPanel[] {
  const declared = panels.some(panel => panel.emphasis !== undefined)
  let left = 0
  return panels.map((panel, index) => {
    const width = Math.max(MIN_WIDTH, Math.round(PANEL_WIDTH * SHRINK ** index))
    const box = { x: left, y: 0, width, height: PANEL_HEIGHT }
    left += width + GAP
    return {
      panel,
      box,
      emphasis: declared ? panel.emphasis === 'last' : index === panels.length - 1,
    }
  })
}

/** The rectangle a set of boxes takes up. */
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
