import { DIRECTION_VERBS, type CanonChoice, type DirectionVerb, type HoldReading } from './holdActions'

/**
 * The directing panel's elements: a Run tab and one tab per proposal. Plain DOM
 * and no Obsidian; every button is handed to the deps, and what the hold says
 * arrives as data from the hold actions.
 */

export interface DirectingBoardDeps {
  /** Renders markdown into an empty element, returning what releases the render. */
  renderMarkdown: (text: string, into: HTMLElement) => () => void
  direct: (verb: DirectionVerb, proposal: string, other?: string) => void
  tickCanon: (id: string, ticked: boolean) => void
  /** Writes the hold for a run that has none. */
  writeHold: () => void
  openMenu: (event: MouseEvent) => void
}

export type DirectingState =
  | { kind: 'idle' }
  | { kind: 'missing'; runId: string }
  | { kind: 'hold'; hold: HoldReading }

/** Longer than this, a proposal is clamped until the reader asks for the whole of it. */
const CLAMP_CHARS = 600

const CLS = 'chain-runner-directing'

export class DirectingBoard {
  private state: DirectingState = { kind: 'idle' }
  /** The proposal whose tab is open; `undefined` is the Run tab. */
  private tab: string | undefined
  private readonly unclamped = new Set<string>()
  private releases: (() => void)[] = []
  private body: HTMLElement | undefined

  constructor(
    private readonly root: HTMLElement,
    private readonly deps: DirectingBoardDeps,
  ) {}

  /** Shows a run afresh, on the named proposal's tab or else the Run tab. */
  open(state: DirectingState, proposal?: string): void {
    this.tab = proposal
    this.unclamped.clear()
    this.draw(state)
    if (this.body) this.body.scrollTop = 0
  }

  /** Redraws what the hold now says, keeping the reader's tab and scroll. */
  draw(state: DirectingState): void {
    this.state = state
    const scroll = this.body?.scrollTop ?? 0
    this.releases.forEach(release => release())
    this.releases = []
    this.root.replaceChildren()
    this.root.classList.add(CLS)

    this.header()
    const body = (this.body = this.add(this.root, 'div', `${CLS}-body`))
    if (state.kind === 'idle') this.add(body, 'div', `${CLS}-empty`, 'Click a card, or a run’s ✎ Direct, on the drawing.')
    if (state.kind === 'missing') this.missing(body, state.runId)
    if (state.kind === 'hold') this.hold(body, state.hold)
    body.scrollTop = scroll
  }

  private header(): void {
    const header = this.add(this.root, 'div', `${CLS}-header`)
    const title = this.add(header, 'div', `${CLS}-title`)
    const runId = this.state.kind === 'hold' ? this.state.hold.runId : this.state.kind === 'missing' ? this.state.runId : undefined
    this.add(title, 'span', '', this.state.kind === 'hold' ? this.state.hold.chainName : 'Directing')
    if (runId) this.add(title, 'span', `${CLS}-faint`, ` · ${runId.split('-').pop() ?? runId}`).title = `run ${runId}`
    if (this.state.kind !== 'hold') return
    const more = this.button(header, '⋯', `${CLS}-more`)
    more.setAttribute('aria-label', 'More')
    more.addEventListener('click', event => this.deps.openMenu(event))
  }

  private missing(body: HTMLElement, runId: string): void {
    this.add(body, 'div', `${CLS}-empty`, `Run ${runId} has no hold note yet.`)
    this.button(body, '✎ Direct this run', 'mod-cta').addEventListener('click', () => this.deps.writeHold())
  }

  private hold(body: HTMLElement, hold: HoldReading): void {
    const proposal = hold.proposals.find(one => one.name === this.tab)
    const tabs = this.add(body, 'div', `${CLS}-tabs`)
    tabs.setAttribute('role', 'tablist')
    this.tabButton(tabs, 'Run', undefined, !proposal)
    for (const one of hold.proposals) this.tabButton(tabs, one.name, one.name, one === proposal)

    if (!proposal) {
      if (hold.verdict) this.markdown(this.section(body, 'Verdict'), hold.verdict)
      this.directionSoFar(this.section(body, 'Direction so far'), hold.direction)
      const ticked = hold.canon.filter(line => line.ticked).length
      if (hold.canon.length > 0) this.canon(this.section(body, `Canon · ${ticked} of ${hold.canon.length} ticked`), hold.canon, true)
      return
    }

    const top = this.section(body)
    this.verbs(top, proposal.name, proposal.given, hold.proposals.map(one => one.name).filter(name => name !== proposal.name))
    this.proposalText(top, proposal.name, proposal.text)
    const canon = hold.canon.filter(line => line.proposer === proposal.name)
    if (canon.length > 0) this.canon(this.section(body, 'Canon from this proposal'), canon, false)
  }

  private tabButton(tabs: HTMLElement, label: string, proposal: string | undefined, selected: boolean): void {
    const tab = this.button(tabs, label, selected ? 'is-selected' : '')
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-selected', String(selected))
    tab.addEventListener('click', () => {
      this.tab = proposal
      this.draw(this.state)
      if (this.body) this.body.scrollTop = 0
    })
  }

  private verbs(el: HTMLElement, name: string, given: DirectionVerb[], others: string[]): void {
    const row = this.add(el, 'div', `${CLS}-verbs`)
    for (const verb of DIRECTION_VERBS) {
      if (verb === 'COMBINE') {
        this.combine(row, name, given.includes(verb), others)
        continue
      }
      const button = this.button(row, verb, given.includes(verb) ? 'is-given' : '')
      button.setAttribute('aria-pressed', String(given.includes(verb)))
      button.addEventListener('click', () => this.deps.direct(verb, name))
    }
  }

  private combine(row: HTMLElement, name: string, given: boolean, others: string[]): void {
    const select = this.add(row, 'select', given ? 'dropdown is-given' : 'dropdown')
    select.disabled = others.length === 0
    this.option(select, '', 'COMBINE…')
    for (const other of others) this.option(select, other, `+ ${other}`)
    select.addEventListener('change', () => {
      if (select.value) this.deps.direct('COMBINE', name, select.value)
    })
  }

  private option(select: HTMLSelectElement, value: string, label: string): void {
    const option = this.add(select, 'option', '', label)
    option.value = value
  }

  private proposalText(el: HTMLElement, name: string, text: string): void {
    const shown = this.add(el, 'div', `${CLS}-proposal`)
    this.markdown(shown, text || '*This proposal is empty.*')
    if (text.length <= CLAMP_CHARS) return
    const whole = this.unclamped.has(name)
    shown.classList.toggle('is-clamped', !whole)
    this.button(el, whole ? 'Show less' : 'Show the whole proposal', `${CLS}-quiet`).addEventListener('click', () => {
      if (whole) this.unclamped.delete(name)
      else this.unclamped.add(name)
      this.draw(this.state)
    })
  }

  private directionSoFar(el: HTMLElement, lines: string[]): void {
    if (lines.length === 0) {
      this.add(el, 'div', `${CLS}-faint`, 'Nothing directed yet')
      return
    }
    const list = this.add(el, 'ul', `${CLS}-direction`)
    for (const line of lines) this.add(list, 'li', '', line)
  }

  /** Checkboxes, grouped under who offered each line when more than one proposal is shown. */
  private canon(el: HTMLElement, lines: CanonChoice[], grouped: boolean): void {
    let proposer: string | undefined
    for (const line of lines) {
      if (grouped && line.proposer !== proposer) this.add(el, 'div', `${CLS}-faint`, (proposer = line.proposer))
      const label = this.add(el, 'label', `${CLS}-canon`)
      const box = this.add(label, 'input')
      box.type = 'checkbox'
      box.checked = line.ticked
      box.addEventListener('change', () => this.deps.tickCanon(line.id, box.checked))
      this.add(label, 'span', '', line.text)
    }
  }

  private section(el: HTMLElement, title?: string): HTMLElement {
    const section = this.add(el, 'div', `${CLS}-section`)
    if (title) this.add(section, 'div', `${CLS}-section-title`, title)
    return section
  }

  private markdown(el: HTMLElement, text: string): void {
    const into = this.add(el, 'div', `${CLS}-markdown`)
    this.releases.push(this.deps.renderMarkdown(text, into))
  }

  private button(el: HTMLElement, text: string, cls: string): HTMLButtonElement {
    return this.add(el, 'button', cls, text)
  }

  private add<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
    const el = parent.ownerDocument.createElement(tag)
    if (cls) el.className = cls
    if (text !== undefined) el.textContent = text
    parent.append(el)
    return el
  }
}
