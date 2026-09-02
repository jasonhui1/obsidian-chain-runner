import type { RunLayout, RunPanel } from '../run/panels'

/**
 * Where a layout's panels go on screen.
 *
 * Not *what* the panels are — the engine settled that, and this module reads
 * `state`, `emphasis` and `round` without ever deciding one (ADR-0001). What is
 * left is the arrangement: a columns chain reads side by side, a loop reads as a
 * list of rounds with one of them open, and everything else stacks. That is a
 * drawing decision, and it is a pure function so all three shapes are checkable
 * without a vault.
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
 * The round to open when the reader has picked none: the one being written, or
 * failing that the last one that landed, or failing that the first.
 *
 * A loop's later rounds are pending for most of the run, so following the front
 * of the run is what keeps the detail pane showing something happening rather
 * than an empty panel the reader has to click away from.
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
 * How to draw the panels the engine sent.
 *
 * `picked` is the round the reader clicked in a sidebar layout; every other kind
 * ignores it. It is deliberately an index into the panels rather than a round
 * number, so a layout whose panels carry no `round` is still selectable.
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
