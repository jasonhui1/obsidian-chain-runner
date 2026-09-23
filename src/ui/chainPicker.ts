import { App, FuzzySuggestModal, Modal, SuggestModal, prepareFuzzySearch } from 'obsidian'
import { anchorModal } from './anchorModal'
import { pickerRows, type Matcher, type PickerRow } from './pickerModel'
import type { Point, Size } from './panelSpot'
import type { ChainSummary } from '../engine/types'
import { MAX_RUN_COUNT, MIN_RUN_COUNT } from './chainNode'

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
  /** Where the click that opened it was; absent means centre-screen (ADR-0010). */
  anchor?: Point
}

const DEFAULT_OPTIONS: Required<Omit<ChainPickerOptions, 'anchor'>> = {
  placeholder: 'Run which chain on this note?',
  unseeded: 'reads its own files — this note is not used',
}

export class ChainPicker extends SuggestModal<PickerRow> {
  private readonly options: Required<Omit<ChainPickerOptions, 'anchor'>>
  readonly anchor: Point | undefined

  constructor(
    app: App,
    private readonly chains: ChainSummary[],
    private readonly onPick: (chain: ChainSummary) => void,
    options: ChainPickerOptions = {},
  ) {
    super(app)
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.anchor = options.anchor
    this.setPlaceholder(this.options.placeholder)
    this.emptyStateText = 'No chain matches'
    // Enough that a workspace of a few dozen chains is not silently truncated.
    this.limit = 100
  }

  override onOpen(): void {
    super.onOpen()
    if (this.anchor) anchorModal(this, this.anchor)
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
    readonly anchor?: Point,
  ) {
    super(app)
    this.setPlaceholder(`Choose ${parameterName}`)
  }

  override onOpen(): void {
    super.onOpen()
    if (this.anchor) anchorModal(this, this.anchor)
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

/** Whether the quick run should use the note or selection as a rough hint. */
export type SeedChoice = 'hint' | 'no-hint'

export class SeedPicker extends FuzzySuggestModal<SeedChoice> {
  constructor(
    app: App,
    private readonly hintLabel: string,
    private readonly onPick: (choice: SeedChoice) => void,
  ) {
    super(app)
    this.setPlaceholder('Choose how to start')
  }

  getItems(): SeedChoice[] {
    return ['hint', 'no-hint']
  }

  getItemText(choice: SeedChoice): string {
    return choice === 'hint' ? this.hintLabel : 'Start with no hint'
  }

  onChooseItem(choice: SeedChoice): void {
    this.onPick(choice)
  }
}

/** The count choice shown only when the engine advertises variance groups. */
export class RunCountPicker extends FuzzySuggestModal<number> {
  private picked = false

  constructor(
    app: App,
    private readonly onPick: (count: number) => void,
    private readonly onCancel?: () => void,
  ) {
    super(app)
    this.setPlaceholder('Run how many times?')
  }

  override onClose(): void {
    super.onClose()
    if (!this.picked) this.onCancel?.()
  }

  getItems(): number[] {
    return Array.from({ length: 10 }, (_, index) => index + 1)
  }

  getItemText(count: number): string {
    return count === 1 ? 'Run once' : `Run ${count} times`
  }

  onChooseItem(count: number): void {
    this.picked = true
    this.onPick(count)
  }
}

export type NodeRunCountChoice = 1 | 2 | 3 | 4 | 5 | 'custom'

/** The count menu attached to an Excalidraw chain node. */
export class NodeRunCountPicker extends FuzzySuggestModal<NodeRunCountChoice> {
  constructor(
    app: App,
    private readonly onPick: (choice: NodeRunCountChoice) => void,
    readonly anchor?: Point,
  ) {
    super(app)
    this.setPlaceholder('Choose run count')
  }

  override onOpen(): void {
    super.onOpen()
    if (this.anchor) anchorModal(this, this.anchor)
  }

  getItems(): NodeRunCountChoice[] {
    return [1, 2, 3, 4, 5, 'custom']
  }

  getItemText(choice: NodeRunCountChoice): string {
    return choice === 'custom' ? 'Custom' : String(choice)
  }

  onChooseItem(choice: NodeRunCountChoice): void {
    this.onPick(choice)
  }
}

const CUSTOM_COUNT_SIZE: Size = { width: 300, height: 190 }

/** A number field for counts outside the quick choices. */
export class CustomRunCountModal extends Modal {
  constructor(
    app: App,
    private readonly onPick: (count: number) => void,
    readonly anchor?: Point,
  ) {
    super(app)
  }

  override onOpen(): void {
    this.titleEl.setText('Custom run count')

    const form = this.contentEl.createEl('form', { cls: 'chain-runner-run-count-form' })
    const field = form.createDiv({ cls: 'setting-item chain-runner-run-count-field' })
    const info = field.createDiv({ cls: 'setting-item-info' })
    info.createEl('label', {
      cls: 'setting-item-name',
      text: 'Number of runs',
      attr: { for: 'chain-runner-custom-run-count' },
    })
    info.createDiv({
      cls: 'setting-item-description',
      text: `Enter a whole number from ${MIN_RUN_COUNT} to ${MAX_RUN_COUNT}.`,
    })
    const control = field.createDiv({ cls: 'setting-item-control' })
    const input = control.createEl('input', {
      cls: 'chain-runner-run-count-input',
      type: 'number',
      placeholder: `${MIN_RUN_COUNT}–${MAX_RUN_COUNT}`,
      attr: {
        id: 'chain-runner-custom-run-count',
        min: MIN_RUN_COUNT,
        max: MAX_RUN_COUNT,
        step: 1,
        required: true,
      },
    })

    const actions = form.createDiv({ cls: 'chain-runner-run-count-actions' })
    const cancel = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } })
    const save = actions.createEl('button', { cls: 'mod-cta', text: 'Set count', attr: { type: 'submit' } })
    save.disabled = true

    const enteredCount = (): number | undefined => parseCustomCount(input.value)
    input.addEventListener('input', () => {
      save.disabled = enteredCount() === undefined
    })
    cancel.addEventListener('click', () => this.close())
    form.addEventListener('submit', event => {
      event.preventDefault()
      const count = enteredCount()
      if (count === undefined) {
        input.focus()
        return
      }
      this.close()
      this.onPick(count)
    })

    input.focus()
    if (this.anchor) anchorModal(this, this.anchor, CUSTOM_COUNT_SIZE)
  }
}

function parseCustomCount(value: string): number | undefined {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const count = Number(trimmed)
  return Number.isInteger(count) && count >= MIN_RUN_COUNT && count <= MAX_RUN_COUNT ? count : undefined
}
