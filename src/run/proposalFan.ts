import type { RunLayout, RunPanel } from './panels'
import type { Box } from '../ui/nodeScene'

/**
 * Initial placement for an expansion's proposals: a column of cards beside the
 * block they were proposed from. The engine decides what the panels are
 * (ADR-0001); this decides only where they land.
 */

/** One proposal, and the rectangle its card is placed in. */
export interface ProposedPanel {
  panel: RunPanel
  /** Its position in the engine's order, which the note it fills is keyed by. */
  index: number
  box: Box
}

const CARD_WIDTH = 300
const CARD_HEIGHT = 200
const GAP = 24
/** Between the source block and the column, with room for the connectors. */
const SOURCE_GAP = 140

/** The proposals for a run, in a column to the right of `source` and centred on it. */
export function buildProposalFan(input: { layout: RunLayout; source: Box }): ProposedPanel[] {
  const { layout, source } = input
  const height = layout.panels.length * CARD_HEIGHT + Math.max(0, layout.panels.length - 1) * GAP
  const top = source.y + source.height / 2 - height / 2
  const x = source.x + source.width + SOURCE_GAP

  return layout.panels.map((panel, index) => ({
    panel,
    index,
    box: { x, y: top + index * (CARD_HEIGHT + GAP), width: CARD_WIDTH, height: CARD_HEIGHT },
  }))
}
