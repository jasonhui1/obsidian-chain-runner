import { arrangeRun, type Arrangement, type RoundEntry } from './arrangement'
import { emptyStateFor, type EmptyState, type EngineReading } from './emptyState'
import { KeyedChildren } from './keyed'
import { PanelBody } from './panelBody'
import { noticeFor } from './panelCopy'
import { panelKeys } from './panelKeys'
import type { LayoutPanel, PanelState } from '../engine/types'
import type { RunPanel } from '../run/panels'
import { seedLine, type RunResult, type RunStatus } from '../run/session'
import { runName } from '../run/runName'

/**
 * The result view's elements, drawn by key: a panel keeps the element it had and
 * is updated in place, so a change lands on something that was already there
 * (ADR-0007). Plain DOM and no Obsidian — markdown is rendered by the deps, and
 * the reader's pick is reported rather than held.
 */

/** What a reader can do with one panel. Both write to the vault, so neither is the view's. */
export interface PanelActions {
  saveAsNote: (panel: RunPanel, run: RunResult) => void
  sendToDrawing: (panel: RunPanel, run: RunResult) => void
  /** Marks lines of the panel to keep, and asks at the end where they go. */
  keepLines: (panel: RunPanel, run: RunResult) => void
}

export interface BoardDeps {
  /** Read on every draw, so the empty state moves with the engine. */
  engine: () => EngineReading
  /** Renders markdown into an empty element, returning what releases the render. */
  renderMarkdown: (text: string, into: HTMLElement) => () => void
  actions?: PanelActions
  /** A round row was activated. Which round is open is the view's to hold. */
  onPickRound: (index: number) => void
}

export interface BoardState {
  result?: RunResult
  /** The round the reader clicked, as `arrangeRun` reads it. */
  pickedRound?: number
}

/** One-shot cue on a panel that has just landed filled; cleared when it finishes. */
export const ARRIVED_CLASS = 'chain-runner-panel--arrived'

const STATUS_LABEL: Record<RunStatus, string> = {
  running: 'running',
  done: 'done',
  failed: 'failed',
}

const STATUSES = Object.keys(STATUS_LABEL) as RunStatus[]
const PANEL_STATES: PanelState[] = ['pending', 'filled', 'empty', 'errored', 'skipped']
const EMPHASES: NonNullable<LayoutPanel['emphasis']>[] = ['last', 'join']

interface HeaderParts {
  el: HTMLElement
  name: HTMLElement
  status: HTMLElement
  moment: HTMLElement
  seed: HTMLElement
  parameter: HTMLElement
  runId: HTMLElement
  error: HTMLElement
  note: HTMLElement
}

interface PanelParts {
  head: HTMLElement
  name: HTMLElement
  lines: HTMLElement
  actions: HTMLElement
  notice: HTMLElement
  body: HTMLElement
  content: PanelBody
  /** The panel drawn now; the action buttons outlive any one draw and read it. */
  panel: RunPanel
}

interface RoundParts {
  number: HTMLElement
  name: HTMLElement
  lines: HTMLElement
  /** Which panel a click on this row opens. */
  index: number
}

interface EmptyParts {
  el: HTMLElement
  title: HTMLElement
  hint: HTMLElement
}

interface Sidebar {
  list: HTMLElement
  detail: HTMLElement
}

export class ResultBoard {
  private readonly panelParts = new Map<string, PanelParts>()
  private readonly roundParts = new Map<string, RoundParts>()
  private readonly panels: KeyedChildren
  private readonly columns: KeyedChildren
  private readonly rounds: KeyedChildren
  private header: HeaderParts | undefined
  private empty: EmptyParts | undefined
  private host: HTMLElement | undefined
  private hostKind: Arrangement['kind'] | undefined
  private sidebar: Sidebar | undefined
  /** The run being drawn, for the action buttons that outlive the draw. */
  private result: RunResult | undefined

  constructor(
    private readonly root: HTMLElement,
    private readonly deps: BoardDeps,
  ) {
    this.panels = new KeyedChildren({
      make: key => this.buildPanel(key),
      onRemove: key => {
        this.panelParts.get(key)?.content.release()
        this.panelParts.delete(key)
      },
    })
    this.columns = new KeyedChildren({ make: () => this.detached('div', 'chain-runner-column') })
    this.rounds = new KeyedChildren({
      make: key => this.buildRound(key),
      onRemove: key => void this.roundParts.delete(key),
    })
  }

  draw(state: BoardState): void {
    this.root.classList.add('chain-runner-result')
    this.result = state.result
    if (!state.result) {
      this.dropHeader()
      this.dropPanels()
      this.drawEmpty(undefined)
      return
    }

    this.drawHeader(state.result)
    if (state.result.layout.panels.length === 0) {
      this.dropPanels()
      this.drawEmpty(state.result.status)
      return
    }
    this.dropEmpty()
    this.drawArrangement(arrangeRun(state.result.layout, state.pickedRound), state.result.status)
  }

  /** Drops every render still held, for a view going away. */
  release(): void {
    this.panels.clear()
  }

  /** An element the keyed children own, left out of the tree until one places it. */
  private detached(tag: 'div' | 'span', cls: string): HTMLElement {
    const el = this.root.ownerDocument.createElement(tag)
    el.className = cls
    return el
  }

  /** A view with no panels, said as the designed state that fits. */
  private drawEmpty(status: RunStatus | undefined): void {
    const empty: EmptyState = emptyStateFor({ run: status ? { status } : undefined, engine: this.deps.engine() })
    const parts = (this.empty ??= this.buildEmpty())
    parts.el.className = `chain-runner-empty chain-runner-empty--${empty.tone}`
    parts.title.textContent = empty.title
    parts.hint.textContent = empty.hint
    if (parts.el.parentElement !== this.root) this.root.append(parts.el)
  }

  private buildEmpty(): EmptyParts {
    const el = div('chain-runner-empty', this.root)
    return { el, title: div('chain-runner-empty-title', el), hint: div('chain-runner-empty-hint', el) }
  }

  private dropEmpty(): void {
    this.empty?.el.remove()
    this.empty = undefined
  }

  private dropPanels(): void {
    this.panels.clear()
    this.columns.clear()
    this.rounds.clear()
    this.host?.remove()
    this.host = undefined
    this.hostKind = undefined
    this.sidebar = undefined
  }

  private dropHeader(): void {
    this.header?.el.remove()
    this.header = undefined
  }

  private drawHeader(result: RunResult): void {
    const parts = (this.header ??= this.buildHeader())
    if (this.root.firstElementChild !== parts.el) this.root.prepend(parts.el)
    if (result.runId) {
      parts.name.textContent = runName({
        chainName: result.chainName,
        dropdownValue: result.parameter?.value,
        startTime: result.startedAt,
      })
      parts.name.title = 'run ' + result.runId
      parts.runId.textContent = ''
      parts.runId.title = 'run ' + result.runId
    } else {
      parts.name.textContent = result.chainName
      parts.name.title = ''
      parts.runId.textContent = ''
      parts.runId.title = ''
    }
    parts.status.textContent = STATUS_LABEL[result.status]
    modifiers(parts.status, 'chain-runner-run-status', STATUSES, result.status)
    parts.moment.textContent = result.moment
    parts.seed.textContent = seedLine(result.seed)
    parts.parameter.textContent = result.parameter ? `${result.parameter.name}: ${result.parameter.value}` : ''
    parts.error.textContent = result.error ?? ''
    // A chain that declared no layout is not a broken one; say which is being shown.
    const undeclared = result.layout.kind === 'undeclared' && result.layout.panels.length > 0
    parts.note.textContent = undeclared ? 'This chain declares no result view — showing the run trace.' : ''
  }

  /** Every line the header can hold, made once. An empty one is hidden by the stylesheet. */
  private buildHeader(): HeaderParts {
    const el = div('chain-runner-run-header', this.root)
    const title = div('chain-runner-run-title', el)
    const moment = div('chain-runner-run-moment', el)
    const meta = div('chain-runner-run-meta', el)
    return {
      el,
      name: span('chain-runner-run-name', title),
      status: span('chain-runner-run-status', title),
      moment,
      seed: span('', meta),
      parameter: span('', meta),
      runId: span('chain-runner-run-id', meta),
      error: div('chain-runner-run-error', el),
      note: div('chain-runner-run-note', el),
    }
  }

  /** The arrangement as elements; `arrangeRun` has already decided what goes where. */
  private drawArrangement(arrangement: Arrangement, status: RunStatus): void {
    const host = this.hostFor(arrangement.kind)

    if (arrangement.kind === 'columns') {
      const keys = panelKeys(arrangement.columns.map(column => column.panel))
      arrangement.columns.forEach((column, index) => {
        const key = keys[index]!
        const { el } = this.columns.use(key, host)
        el.classList.toggle('chain-runner-column--wide', column.converging)
        this.drawPanel(key, column.panel, status, el)
      })
    } else if (arrangement.kind === 'sidebar') {
      const { list, detail } = this.sidebar!
      const keys = panelKeys(arrangement.rounds.map(round => round.panel))
      arrangement.rounds.forEach((entry, index) => this.drawRound(keys[index]!, entry, list))
      const open = arrangement.rounds.findIndex(entry => entry.selected)
      if (arrangement.detail && open !== -1) this.drawPanel(keys[open]!, arrangement.detail, status, detail)
    } else {
      const keys = panelKeys(arrangement.panels)
      arrangement.panels.forEach((panel, index) => this.drawPanel(keys[index]!, panel, status, host))
    }

    this.panels.end()
    this.columns.end()
    this.rounds.end()
  }

  /** The container for this shape, rebuilt only when the shape itself changes. */
  private hostFor(kind: Arrangement['kind']): HTMLElement {
    if (this.host && this.hostKind === kind) {
      if (this.host.parentElement !== this.root) this.root.append(this.host)
      return this.host
    }
    this.dropPanels()
    const host = div(kind === 'stack' ? 'chain-runner-panels' : `chain-runner-panels chain-runner-panels--${kind}`, this.root)
    if (kind === 'sidebar') {
      const list = div('chain-runner-rounds', host)
      list.setAttribute('role', 'listbox')
      this.sidebar = { list, detail: div('chain-runner-detail', host) }
    }
    this.host = host
    this.hostKind = kind
    return host
  }

  /** One row of the round list: which round it is, how much it holds, and how it went. */
  private drawRound(key: string, entry: RoundEntry, list: HTMLElement): void {
    const { el } = this.rounds.use(key, list)
    const parts = this.roundParts.get(key)!
    parts.index = entry.index
    modifiers(el, 'chain-runner-round', PANEL_STATES, entry.panel.state)
    el.classList.toggle('chain-runner-round--selected', entry.selected)
    el.setAttribute('aria-selected', String(entry.selected))
    // Rounds of a loop share a name, so the iteration is what tells rows apart.
    // 0-based on the wire, 1-based to read.
    parts.number.textContent = entry.round === undefined ? '' : String(entry.round + 1)
    parts.name.textContent = entry.panel.name
    parts.lines.textContent = lineLabel(entry.panel)
  }

  private buildRound(key: string): HTMLElement {
    const el = this.detached('div', 'chain-runner-round')
    const parts: RoundParts = {
      number: span('chain-runner-round-number', el),
      name: span('chain-runner-round-name', el),
      lines: span('chain-runner-round-lines', el),
      index: 0,
    }
    this.roundParts.set(key, parts)
    // A row is a control, so it answers the keyboard as well as the mouse.
    el.tabIndex = 0
    el.setAttribute('role', 'option')
    el.onclick = (): void => this.deps.onPickRound(parts.index)
    el.onkeydown = (event): void => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      this.deps.onPickRound(parts.index)
    }
    return el
  }

  private drawPanel(key: string, panel: RunPanel, status: RunStatus, parent: HTMLElement): void {
    const { el, fresh } = this.panels.use(key, parent)
    const parts = this.panelParts.get(key)!
    const landed = !fresh && parts.panel.state === 'pending' && panel.state === 'filled'
    parts.panel = panel

    modifiers(el, 'chain-runner-panel', PANEL_STATES, panel.state)
    modifiers(el, 'chain-runner-panel', EMPHASES, panel.emphasis)
    if (landed) restart(el)

    parts.name.textContent = panel.name
    parts.lines.textContent = lineLabel(panel)
    // An output note is stamped with the run, so a run without an id has none to offer.
    const acting = Boolean(this.deps.actions && this.result?.runId && panel.state === 'filled')
    children(parts.head, [parts.name, parts.lines, ...(acting ? [parts.actions] : [])])

    const notice = noticeFor(panel, status)
    if (notice) {
      parts.notice.className = `chain-runner-panel-notice chain-runner-panel-notice--${notice.tone}`
      parts.notice.textContent = notice.text
    }

    const settled = panel.state === 'filled'
    const text = settled ? panel.text : (panel.streaming ?? '')
    if (settled) parts.content.settle(text)
    else parts.content.stream(text)

    children(el, [parts.head, ...(notice ? [parts.notice] : []), ...(text === '' ? [] : [parts.body])])
  }

  private buildPanel(key: string): HTMLElement {
    const el = this.detached('div', 'chain-runner-panel')
    const head = div('chain-runner-panel-head', el)
    const body = div('chain-runner-panel-body', el)
    const parts: PanelParts = {
      head,
      name: span('chain-runner-panel-name', head),
      lines: span('chain-runner-panel-lines', head),
      actions: div('chain-runner-panel-actions', head),
      notice: div('chain-runner-panel-notice', el),
      body,
      content: new PanelBody(body, this.deps.renderMarkdown),
      panel: { name: '', node: '', text: '', lines: 0, state: 'pending' },
    }
    this.action(parts, 'Save as note', run => this.deps.actions?.saveAsNote(parts.panel, run))
    this.action(parts, 'Keep lines', run => this.deps.actions?.keepLines(parts.panel, run))
    this.action(parts, 'Send to drawing', run => this.deps.actions?.sendToDrawing(parts.panel, run))
    this.panelParts.set(key, parts)
    // The cue marks the arrival, not every draw after it.
    el.addEventListener('animationend', event => {
      if (event.target === el) el.classList.remove(ARRIVED_CLASS)
    })
    return el
  }

  private action(parts: PanelParts, label: string, act: (run: RunResult) => void): void {
    const el = this.root.ownerDocument.createElement('button')
    el.className = 'chain-runner-panel-action'
    el.textContent = label
    el.onclick = (event): void => {
      // A round row above the panel is clickable; this click is not for it.
      event.stopPropagation()
      if (this.result) act(this.result)
    }
    parts.actions.append(el)
  }
}

/** Runs the arrival cue, from the start when one is somehow still going. */
function restart(el: HTMLElement): void {
  el.classList.remove(ARRIVED_CLASS)
  // Reading the layout is what starts the keyframe again; re-adding a class the
  // element still has would not.
  void el.offsetWidth
  el.classList.add(ARRIVED_CLASS)
}

/** How much a panel holds, in the one wording both the panel head and a round row use. */
function lineLabel(panel: RunPanel): string {
  return panel.lines ? `${panel.lines} ln` : '—'
}

function div(cls: string, parent: HTMLElement): HTMLElement {
  const el = parent.ownerDocument.createElement('div')
  el.className = cls
  parent.append(el)
  return el
}

function span(cls: string, parent: HTMLElement): HTMLElement {
  const el = parent.ownerDocument.createElement('span')
  if (cls) el.className = cls
  parent.append(el)
  return el
}

/** Sets the one modifier of `base` that applies, leaving classes that are not its. */
function modifiers(el: HTMLElement, base: string, all: readonly string[], active: string | undefined): void {
  for (const candidate of all) el.classList.toggle(`${base}--${candidate}`, candidate === active)
}

/** Puts `wanted` in `parent`, in order, touching the DOM only when it differs. */
function children(parent: HTMLElement, wanted: HTMLElement[]): void {
  const now = parent.children
  if (now.length === wanted.length && wanted.every((el, index) => now[index] === el)) return
  parent.replaceChildren(...wanted)
}
