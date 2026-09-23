import type { OpenOutputNote, OutputNotes, RunProvenance } from './outputNotes'
import type { RunLayout, RunPanel } from '../run/panels'
import type { PanelState } from '../engine/types'

/**
 * A run's outputs filling in place (ADR-0003): one note per placed panel,
 * rewritten as the engine streams. Shared by every surface that lands a run on a
 * drawing — where the notes *go* is the caller's.
 */

/** One output being filled: the note, and which panel's words go in it. */
export interface LiveOutput<P> {
  /** Its panel's position in the engine's order. */
  index: number
  /** Where the caller put it, handed back so the caller can place what it opened. */
  place: P
  note: OpenOutputNote
  /** What it was last written from, which sets the flush cadence. */
  written: { text: string; state: PanelState }
}

/** A place a panel was given: its position in the engine's order, and the panel. */
export interface PlacedPanel {
  index: number
  panel: RunPanel
}

/**
 * One empty note per placed panel. A note the vault refuses is left out — it has
 * said so already, and the rest of the run still lands.
 */
export async function openLiveOutputs<P extends PlacedPanel>(input: {
  places: readonly P[]
  notes: OutputNotes
  run: RunProvenance
}): Promise<LiveOutput<P>[]> {
  const outputs: LiveOutput<P>[] = []
  for (const place of input.places) {
    const note = await input.notes.open(place.panel, input.run)
    if (!note) continue
    outputs.push({ index: place.index, place, note, written: { text: '', state: 'pending' } })
  }
  return outputs
}

/** Writes each output into its note. `force` is a settled run's last flush. */
export async function fillLiveOutputs<P>(
  outputs: readonly LiveOutput<P>[],
  layout: RunLayout,
  force: boolean,
): Promise<void> {
  for (const output of outputs) {
    // By index, never by place in the frame: `columns` reorders.
    const panel = layout.panels[output.index]
    if (!panel) continue
    const shown = { ...panel, text: shownText(panel) }
    if (!force && !worthWriting(output.written, shown)) continue
    output.written = { text: shown.text, state: shown.state }
    await output.note.write(shown, force)
  }
}

/** A panel's settled text, or the tokens so far. */
function shownText(panel: RunPanel): string {
  return panel.streaming ?? panel.text
}

/**
 * A line at a time, the spike's cadence (`docs/spike-ea.md`, Q2): an embeddable
 * repaints per write, so a write per token buys nothing. A hop's unfinished last
 * line is flushed by the state change when it settles.
 */
function worthWriting(before: { text: string; state: PanelState }, panel: RunPanel): boolean {
  if (before.state !== panel.state) return true
  return finishedLines(panel.text) > finishedLines(before.text)
}

/** The line still being written is not a finished one. */
function finishedLines(text: string): number {
  return text.trimEnd().split('\n').length - 1
}
