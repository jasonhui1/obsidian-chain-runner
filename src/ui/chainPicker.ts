import { App, FuzzySuggestModal, SuggestModal, prepareFuzzySearch } from 'obsidian'
import { pickerRows, type Matcher, type PickerRow } from './pickerModel'
import type { ChainSummary } from '../engine/types'

/**
 * The chain picker: purpose groups, the moment in grey under each name, and a
 * fuzzy search that filters across all of them.
 *
 * Obsidian's suggest modals have no group headers, and a header rendered as its
 * own suggestion would be a row the arrow keys stop on. So the heading is drawn
 * inside the first row of its group instead — every row stays selectable, and
 * the headings never move under the reader's cursor.
 */
export class ChainPicker extends SuggestModal<PickerRow> {
  constructor(
    app: App,
    private readonly chains: ChainSummary[],
    private readonly onPick: (chain: ChainSummary) => void,
  ) {
    super(app)
    this.setPlaceholder('Run which chain on this note?')
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
 * The one dropdown a chain may declare, asked for before the run rather than
 * left empty. A chain that declares a parameter reads it as an input; running it
 * without one runs a different chain than the reader asked for.
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
