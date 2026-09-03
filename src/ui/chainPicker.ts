import { App, FuzzySuggestModal, SuggestModal, prepareFuzzySearch } from 'obsidian'
import { pickerRows, type Matcher, type PickerRow } from './pickerModel'
import type { ChainSummary } from '../engine/types'

/**
 * The chain picker: purpose groups, the moment under each name, and a fuzzy
 * search across all of them. Obsidian's suggest modals have no group headers, so
 * a heading is drawn inside the first row of its group and every row stays
 * selectable.
 */
/** The two lines that differ between running a chain on a note and adding one to a drawing. */
export interface ChainPickerOptions {
  placeholder?: string
  /** Said under a chain that reads no seed; named for what it will not read here. */
  unseeded?: string
}

const DEFAULT_OPTIONS: Required<ChainPickerOptions> = {
  placeholder: 'Run which chain on this note?',
  unseeded: 'reads its own files — this note is not used',
}

export class ChainPicker extends SuggestModal<PickerRow> {
  private readonly options: Required<ChainPickerOptions>

  constructor(
    app: App,
    private readonly chains: ChainSummary[],
    private readonly onPick: (chain: ChainSummary) => void,
    options: ChainPickerOptions = {},
  ) {
    super(app)
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.setPlaceholder(this.options.placeholder)
    this.emptyStateText = 'No chain matches'
    // Enough that a workspace of a few dozen chains is not silently truncated.
    this.limit = 100
  }

  getSuggestions(query: string): PickerRow[] {
    return pickerRows(this.chains, query, fuzzy)
  }

  renderSuggestion(row: PickerRow, el: HTMLElement): void {
    el.addClass('chain-runner-suggestion')
    if (row.groupStart) el.createDiv({ cls: 'chain-runner-suggestion-heading', text: row.heading })
    el.createDiv({ cls: 'chain-runner-suggestion-name', text: row.chain.name })
    if (row.note) el.createDiv({ cls: 'chain-runner-suggestion-note', text: row.note })
    // Said before the run: this chain reads its own files, not what it was pointed at.
    if (!row.readsNote) {
      el.createDiv({ cls: 'chain-runner-suggestion-warning', text: this.options.unseeded })
    }
  }

  onChooseSuggestion(row: PickerRow): void {
    this.onPick(row.chain)
  }
}

/** Obsidian's own fuzzy search, narrowed to the score the row order reads. */
function fuzzy(query: string): Matcher {
  const search = prepareFuzzySearch(query)
  return text => search(text)?.score ?? null
}

/**
 * The one dropdown a chain may declare, asked before the run: a chain reads its
 * parameter as an input, so an unset one runs something else.
 */
export class ParameterPicker extends FuzzySuggestModal<string> {
  constructor(
    app: App,
    parameterName: string,
    private readonly options: string[],
    private readonly onPick: (value: string) => void,
  ) {
    super(app)
    this.setPlaceholder(`Choose ${parameterName}`)
  }

  getItems(): string[] {
    return this.options
  }

  getItemText(option: string): string {
    return option
  }

  onChooseItem(option: string): void {
    this.onPick(option)
  }
}
