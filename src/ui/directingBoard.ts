import {
  DIRECTION_VERBS,
  type CanonChoice,
  type ConversationEntry,
  type DirectionVerb,
  type HoldProposal,
  type HoldReading,
  type RepliedTurn,
  sameTurn,
} from './holdActions'
import { TypingBoxes } from './typingBoxes'

/** The directing panel's elements: a Run tab, and a tab per proposal. Plain DOM; every button is handed to the deps. */

export interface DirectingBoardDeps {
  /** Renders markdown into an empty element, returning what releases the render. */
  renderMarkdown: (text: string, into: HTMLElement) => () => void
  direct: (verb: DirectionVerb, proposal: string, other?: string) => void
  undirect: (verb: DirectionVerb, proposal: string, other?: string) => void
  tickCanon: (id: string, ticked: boolean) => void
  /** Writes the hold for a run that has none. */
  writeHold: () => void
  /** Each answers whether what was typed reached the hold. */
  chat: (proposal: string, message: string) => Promise<boolean>
  askRoom: (question: string) => Promise<boolean>
  change: (text: string) => Promise<boolean>
  revise: (turn: RepliedTurn) => Promise<void>
  /** Answers whether the proposal’s new words reached the hold. */
  editProposal: (proposal: string, text: string) => Promise<boolean>
  /** Reruns downstream of every edited proposal. */
  rerun: () => Promise<void>
  openMenu: (event: MouseEvent) => void
  /** Reports whether `frame` cuts its content off, now and whenever that changes; returns what stops it. */
  watchOverflow: (frame: HTMLElement, changed: (overflowing: boolean) => void) => () => void
}

export type DirectingState =
  | { kind: 'idle' }
  | { kind: 'missing'; runId: string }
  | { kind: 'hold'; hold: HoldReading }

const CLS = 'chain-runner-directing'

export class DirectingBoard {
  private state: DirectingState = { kind: 'idle' }
  /** The proposal whose tab is open; `undefined` is the Run tab. */
  private tab: string | undefined
  private readonly unclamped = new Set<string>()
  private readonly boxes = new TypingBoxes(() => this.draw(this.state))
  /** What each run is being rerun from while its rerun goes: its edits, or a reply. */
  private readonly rerunning = new Map<string, RepliedTurn | 'edits'>()
  /** Each proposal being edited, by its box key, and the words so far. */
  private readonly editing = new Map<string, string>()
  private readonly saving = new Set<string>()
  private releases: (() => void)[] = []
  private body: HTMLElement | undefined

  constructor(
    private readonly root: HTMLElement,
    private readonly deps: DirectingBoardDeps,
  ) {}

  /** Shows a run afresh, on the named proposal's tab or else the Run tab. */
  open(state: DirectingState, proposal?: string): void {
    this.unclamped.clear()
    this.showTab(state, proposal)
  }

  /** Redraws what the hold now says, keeping the reader's tab and scroll. */
  draw(state: DirectingState): void {
    this.state = state
    const scroll = this.body?.scrollTop ?? 0
    const keepTyping = this.boxes.keepTyping(this.root)
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
    keepTyping()
  }

  private header(): void {
    const header = this.add(this.root, 'div', `${CLS}-header`)
    const title = this.add(header, 'div', `${CLS}-title`)
    const runId = runIdOf(this.state)
    this.add(title, 'span', '', this.state.kind === 'hold' ? this.state.hold.chainName : 'Directing')
    if (runId) this.add(title, 'span', `${CLS}-faint`, ` · ${shortId(runId)}`).title = `run ${runId}`
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
    this.rerunBar(body, hold)

    if (!proposal) {
      if (hold.verdict) this.markdown(this.section(body, 'Verdict'), hold.verdict)
      const direction = this.section(body, 'Direction so far')
      this.directionSoFar(direction, hold.direction)
      this.boxes.draw(direction, {
        key: boxKey(hold.runId, 'change'),
        placeholder: 'What should change…',
        label: 'Add',
        send: text => this.deps.change(text),
      })
      this.room(this.section(body, 'Ask the room'), hold)
      const ticked = hold.canon.filter(line => line.ticked).length
      if (hold.canon.length > 0) this.canon(this.section(body, `Canon · ${ticked} of ${hold.canon.length} ticked`), hold.canon, true)
      return
    }

    const top = this.section(body)
    this.verbs(top, proposal, hold.proposals.map(one => one.name).filter(name => name !== proposal.name))
    const editKey = boxKey(hold.runId, `edit ${proposal.name}`)
    if (this.editing.has(editKey)) this.editor(top, editKey, proposal.name)
    else this.proposalText(top, hold.runId, proposal.name, proposal.text)
    const canon = hold.canon.filter(line => line.proposer === proposal.name)
    if (canon.length > 0) this.canon(this.section(body, 'Canon from this proposal'), canon, false)
    this.chat(this.section(body, `Chat with ${proposal.name}`), hold, proposal.name)
  }

  private chat(el: HTMLElement, hold: HoldReading, name: string): void {
    const key = boxKey(hold.runId, `chat ${name}`)
    const turns = hold.conversation.filter((entry): entry is ChatEntry => entry.kind === 'chat' && entry.name === name)
    const pending = this.boxes.waiting(key)
    if (turns.length === 0 && pending === undefined) this.add(el, 'div', `${CLS}-faint`, `Nothing said to ${name} yet`)
    for (const turn of turns) {
      const shown = this.turn(el, turn.message)
      if (turn.reply === undefined) this.add(shown, 'div', `${CLS}-faint`, 'No reply')
      else this.markdown(shown, turn.reply)
      if (turn.revisedAs) this.add(shown, 'div', `${CLS}-faint`, `Used as the revision · run ${shortId(turn.revisedAs)}`)
      else if (turn.reply !== undefined) this.reviseButton(shown, hold.runId, { name, message: turn.message, reply: turn.reply })
    }
    if (pending !== undefined) this.add(this.turn(el, pending), 'div', `${CLS}-faint`, `${name} is replying…`)
    this.boxes.draw(el, { key, placeholder: `Message ${name}…`, label: 'Send', send: text => this.deps.chat(name, text) })
  }

  private room(el: HTMLElement, hold: HoldReading): void {
    const key = boxKey(hold.runId, 'room')
    const pending = this.boxes.waiting(key)
    for (const entry of hold.conversation) {
      if (entry.kind !== 'room') continue
      const shown = this.turn(el, entry.question)
      for (const answer of entry.answers) {
        this.add(shown, 'div', `${CLS}-answerer`, answer.name)
        this.markdown(shown, answer.answer)
      }
    }
    if (pending !== undefined) this.add(this.turn(el, pending), 'div', `${CLS}-faint`, 'The room is answering…')
    this.boxes.draw(el, { key, placeholder: 'Ask every proposal…', label: 'Ask', send: text => this.deps.askRoom(text) })
  }

  /** One exchange: what was said, with whatever came back added under it by the caller. */
  private turn(el: HTMLElement, said: string): HTMLElement {
    const turn = this.add(el, 'div', `${CLS}-turn`)
    this.add(turn, 'div', `${CLS}-said`, said)
    return turn
  }

  /** While a run's rerun goes, nothing else of it can start one. */
  private reviseButton(el: HTMLElement, runId: string, turn: RepliedTurn): void {
    const going = this.rerunning.get(runId)
    const label = going && going !== 'edits' && sameTurn(going, turn) ? 'Rerunning…' : 'Use this reply as the revision & rerun'
    const button = this.button(el, label, `${CLS}-quiet`)
    button.disabled = going !== undefined
    button.addEventListener('click', () => void this.startRerun(runId, turn, () => this.deps.revise(turn)))
  }

  private rerunBar(body: HTMLElement, hold: HoldReading): void {
    const edited = hold.proposals.filter(one => one.edited).map(one => one.name)
    if (edited.length === 0) return
    const bar = this.add(body, 'div', `${CLS}-rerun`)
    this.add(bar, 'span', `${CLS}-faint`, `Edited: ${edited.join(', ')}`)
    const going = this.rerunning.get(hold.runId)
    const button = this.button(bar, going === 'edits' ? 'Rerunning…' : '⟳ Rerun downstream', 'mod-cta')
    button.disabled = going !== undefined
    button.addEventListener('click', () => void this.startRerun(hold.runId, 'edits', () => this.deps.rerun()))
  }

  private async startRerun(runId: string, from: RepliedTurn | 'edits', rerun: () => Promise<void>): Promise<void> {
    if (this.rerunning.has(runId)) return
    this.rerunning.set(runId, from)
    this.draw(this.state)
    try {
      await rerun()
    } finally {
      this.rerunning.delete(runId)
      this.draw(this.state)
    }
  }

  private tabButton(tabs: HTMLElement, label: string, proposal: string | undefined, selected: boolean): void {
    const tab = this.button(tabs, label, selected ? 'is-selected' : '')
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-selected', String(selected))
    tab.addEventListener('click', () => this.showTab(this.state, proposal))
  }

  private showTab(state: DirectingState, proposal: string | undefined): void {
    this.tab = proposal
    this.draw(state)
    if (this.body) this.body.scrollTop = 0
  }

  /** A verb already given is taken back when pressed again. */
  private verbs(el: HTMLElement, proposal: HoldProposal, others: string[]): void {
    const row = this.add(el, 'div', `${CLS}-verbs`)
    for (const verb of DIRECTION_VERBS) {
      if (verb === 'COMBINE') {
        this.combine(row, proposal, others)
        continue
      }
      const given = proposal.given.includes(verb)
      const button = this.button(row, verb, given ? 'is-given' : '')
      button.setAttribute('aria-pressed', String(given))
      button.addEventListener('click', () => (given ? this.deps.undirect : this.deps.direct)(verb, proposal.name))
    }
  }

  private combine(row: HTMLElement, proposal: HoldProposal, others: string[]): void {
    const select = this.add(row, 'select', proposal.combinedWith.length > 0 ? 'dropdown is-given' : 'dropdown')
    select.disabled = others.length === 0
    this.option(select, '', 'COMBINE…')
    for (const other of others) this.option(select, other, `${proposal.combinedWith.includes(other) ? '✓' : '+'} ${other}`)
    select.addEventListener('change', () => {
      const other = select.value
      if (!other) return
      ;(proposal.combinedWith.includes(other) ? this.deps.undirect : this.deps.direct)('COMBINE', proposal.name, other)
    })
  }

  private option(select: HTMLSelectElement, value: string, label: string): void {
    const option = this.add(select, 'option', '', label)
    option.value = value
  }

  private proposalText(el: HTMLElement, runId: string, name: string, text: string): void {
    const shown = this.add(el, 'div', `${CLS}-proposal`)
    this.markdown(shown, text || '*This proposal is empty.*')
    const whole = this.unclamped.has(name)
    shown.classList.toggle('is-clamped', !whole)
    const actions = this.add(el, 'div', `${CLS}-proposal-actions`)
    const toggle = this.button(actions, whole ? 'Show less' : 'Show the whole proposal', `${CLS}-quiet`)
    toggle.hidden = !whole
    const edit = this.button(actions, '✎ Edit', `${CLS}-quiet`)
    edit.disabled = this.rerunning.has(runId)
    edit.addEventListener('click', () => {
      this.editing.set(boxKey(runId, `edit ${name}`), text)
      this.draw(this.state)
    })
    toggle.addEventListener('click', () => {
      if (whole) this.unclamped.delete(name)
      else this.unclamped.add(name)
      this.draw(this.state)
    })
    if (whole) return
    this.releases.push(
      this.deps.watchOverflow(shown, overflowing => {
        shown.classList.toggle('is-overflowing', overflowing)
        toggle.hidden = !overflowing
      }),
    )
  }

  /** Enter starts a new line: a proposal runs to many. */
  private editor(el: HTMLElement, key: string, name: string): void {
    const editor = this.add(el, 'div', `${CLS}-editor`)
    const input = this.add(editor, 'textarea')
    input.value = this.editing.get(key) ?? ''
    input.rows = 12
    input.dataset.box = key
    input.addEventListener('input', () => void this.editing.set(key, input.value))
    const row = this.add(editor, 'div', `${CLS}-editor-actions`)
    const save = this.button(row, 'Save', 'mod-cta')
    save.disabled = this.saving.has(key)
    save.addEventListener('click', () => void this.save(key, name))
    this.button(row, 'Cancel', '').addEventListener('click', () => {
      this.editing.delete(key)
      this.draw(this.state)
    })
  }

  private async save(key: string, name: string): Promise<void> {
    const text = this.editing.get(key)
    if (text === undefined || this.saving.has(key)) return
    this.saving.add(key)
    this.draw(this.state)
    try {
      if (await this.deps.editProposal(name, text)) this.editing.delete(key)
    } finally {
      this.saving.delete(key)
      this.draw(this.state)
    }
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

type ChatEntry = Extract<ConversationEntry, { kind: 'chat' }>

function boxKey(runId: string, box: string): string {
  return `${runId} ${box}`
}

function shortId(runId: string): string {
  return runId.split('-').pop() ?? runId
}

function runIdOf(state: DirectingState): string | undefined {
  if (state.kind === 'hold') return state.hold.runId
  return state.kind === 'missing' ? state.runId : undefined
}
