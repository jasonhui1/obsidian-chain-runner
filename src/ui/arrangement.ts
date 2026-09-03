import type { RunLayout, RunPanel } from '../run/panels'

/**
 * Where a layout's panels go on screen, not what they are (ADR-0001): columns
 * side by side, a loop as a list of rounds with one open, everything else
 * stacked.
 */

/** One column of a `columns` layout. */
export interface Column {
  panel: RunPanel
  /** The panel the branches converge on — the one they were all run to produce. */
  converging: boolean
}

/** One row of a `sidebar` layout's round list. */
export interface RoundEntry {
  /** Position in the layout's panels, and what a click hands back as the pick. */
  index: number
  /** The loop iteration the engine tagged the panel with, when it tagged one. */
  round?: number
  panel: RunPanel
  selected: boolean
}

export type Arrangement =
  | { kind: 'stack'; panels: RunPanel[] }
  | { kind: 'columns'; columns: Column[] }
  | { kind: 'sidebar'; rounds: RoundEntry[]; detail?: RunPanel }

/**
 * The round to open when the reader has picked none: the one being written, else
 * the last that landed, else the first — so the detail pane follows the run.
 */
function frontOfRun(panels: RunPanel[]): number {
  const writing = panels.findLastIndex(panel => Boolean(panel.streaming))
  if (writing !== -1) return writing
  const landed = panels.findLastIndex(panel => panel.state !== 'pending')
  return landed === -1 ? 0 : landed
}

/** The reader's pick when they have made one and it still exists, else the front of the run. */
function selectedRound(panels: RunPanel[], picked: number | undefined): number {
  if (picked !== undefined && picked >= 0 && picked < panels.length) return picked
  return frontOfRun(panels)
}

/**
 * How to draw the panels the engine sent. `picked` is a sidebar layout's clicked
 * round — an index, not a round number, so panels without a `round` still select.
 */
export function arrangeRun(layout: RunLayout, picked?: number): Arrangement {
  if (layout.kind === 'columns') {
    return { kind: 'columns', columns: layout.panels.map(panel => ({ panel, converging: panel.emphasis === 'join' })) }
  }

  if (layout.kind === 'sidebar') {
    const selected = selectedRound(layout.panels, picked)
    return {
      kind: 'sidebar',
      rounds: layout.panels.map((panel, index) => ({ index, round: panel.round, panel, selected: index === selected })),
      detail: layout.panels[selected],
    }
  }

  return { kind: 'stack', panels: layout.panels }
}
