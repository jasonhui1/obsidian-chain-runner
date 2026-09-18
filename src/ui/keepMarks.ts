import { FuzzySuggestModal, type App } from 'obsidian'
import { baseName, fileName, type NoteStore } from './noteStore'
import { NOT_SETTLED } from './keepPiece'
import type { OutputNotes } from './outputNotes'
import { keptNoteContent, keptNotePath, trimToMarks, type MarkRange } from '../run/keepMarks'
import { lineCount, type RunPanel } from '../run/panels'
import type { SeedSource } from '../run/seed'
import type { RunResult } from '../run/session'

/**
 * Keep-marks end to end: the reader marks lines, and at the end says where they
 * go — a trimmed note, or the seed of the next chain. What the marks mean lives
 * in `src/run/keepMarks.ts`; the marking surface is `./markLines.ts`.
 */

/** The text being marked, and what a note trimmed out of it says it came from. */
export type MarkSource =
  /** A panel of a run: what it keeps is an output note, cut down. */
  | { kind: 'panel'; text: string; panel: RunPanel; run: RunResult }
  /** A note in the vault: what it keeps goes beside it. */
  | { kind: 'note'; text: string; path: string }

/** Opens the marking surface over `text`, and answers with the ranges marked. */
export type Marker = (text: string, onDone: (marked: MarkRange[]) => void) => void

export interface KeepMarksDeps {
  /** For the destination picker. */
  app: App
  store: NoteStore
  notify: (message: string) => void
  /** The output-note convention, shared with every other way of keeping a piece. */
  notes: OutputNotes
  mark: Marker
  /** Launches a chain on the kept text: the picker, then the run. */
  runChain: (input: { text: string; source: SeedSource }) => void
}

export const NOTHING_TO_MARK = 'There are no lines here to mark'
export const NOTHING_MARKED = 'No lines marked — nothing to keep'

type Destination = 'note' | 'chain'

export class KeepMarks {
  constructor(private readonly deps: KeepMarksDeps) {}

  start(source: MarkSource): void {
    if (source.text.trim() === '') {
      this.deps.notify(NOTHING_TO_MARK)
      return
    }
    this.deps.mark(source.text, marked => this.chooseDestination(source, marked))
  }

  /** Asked once, at the end: the marks are made before there is anywhere to put them. */
  private chooseDestination(source: MarkSource, marked: MarkRange[]): void {
    const kept = trimToMarks(source.text, marked)
    if (kept === '') {
      this.deps.notify(NOTHING_MARKED)
      return
    }
    new DestinationPicker(this.deps.app, destination => {
      if (destination === 'chain') this.deps.runChain({ text: kept, source: seedSource(source) })
      else void this.writeNote(source, kept)
    }).open()
  }

  private async writeNote(source: MarkSource, kept: string): Promise<void> {
    const path = source.kind === 'panel' ? await this.keptPanel(source, kept) : await this.keptNote(source, kept)
    if (path) await this.deps.store.open(path)
  }

  /** A trimmed panel is still that run's output, so it keeps the run's provenance. */
  private async keptPanel(source: Extract<MarkSource, { kind: 'panel' }>, kept: string): Promise<string | undefined> {
    const { panel, run } = source
    if (!run.runId) {
      this.deps.notify(NOT_SETTLED)
      return undefined
    }
    const trimmed: RunPanel = {
      ...panel,
      name: `${panel.name} (kept)`,
      text: kept,
      lines: lineCount(kept),
      state: 'filled',
    }
    return this.deps.notes.write(trimmed, { runId: run.runId, chainName: run.chainName })
  }

  /** A note trimmed from a note: beside it, naming it. */
  private async keptNote(source: Extract<MarkSource, { kind: 'note' }>, kept: string): Promise<string | undefined> {
    const { path } = source
    return this.deps.notes.writeNote(
      keptNotePath(path, baseName(path)),
      keptNoteContent(kept, { note: baseName(path) }),
    )
  }
}

/** What the run header names as the seed, when the kept text is run as one. */
function seedSource(source: MarkSource): SeedSource {
  if (source.kind === 'note') return { name: fileName(source.path), path: source.path }
  // A panel has no note behind it; links in it resolve against the vault root.
  return { name: `${source.run.chainName} · ${source.panel.name}`, path: '' }
}

const DESTINATIONS: Record<Destination, string> = {
  note: 'Keep as a trimmed note',
  chain: 'Run a chain on the marked lines',
}

/** Where the marks go, asked once the marking is done. */
class DestinationPicker extends FuzzySuggestModal<Destination> {
  constructor(
    app: App,
    private readonly onPick: (destination: Destination) => void,
  ) {
    super(app)
    this.setPlaceholder('Where do the marked lines go?')
  }

  getItems(): Destination[] {
    return ['note', 'chain']
  }

  getItemText(destination: Destination): string {
    return DESTINATIONS[destination]
  }

  onChooseItem(destination: Destination): void {
    this.onPick(destination)
  }
}
