import {
  canonNote,
  DIRECTION_VERBS,
  type CanonChoice,
  type ConversationEntry,
  type DirectionVerb,
  type HoldPick,
  type HoldProposal,
  type HoldReading,
  type RepliedTurn,
  type OnRerunProgress,
  type RerunProgress,
  type Resumed,
  rerunDoing,
  sameTurn,
} from './holdActions'
import type { ProposalEditor } from './proposalEditor'
import { TypingBoxes } from './typingBoxes'

/** The directing panel's elements: a Run tab, and a tab per proposal. Plain DOM; every button is handed to the deps. */

export interface DirectingBoardDeps {
  /** Renders markdown into an empty element, returning what releases the render. */
  renderMarkdown: (text: string, into: HTMLElement) => () => void
  direct: (verb: DirectionVerb, proposal: string, other?: string) => void
  undirect: (verb: DirectionVerb, proposal: string, other?: string) => void
  tickCanon: (id: string, ticked: boolean) => void
  /** A hold's candidate, by its heading, picked or unpicked. */
  tickCandidate: (nodeId: string, heading: string, ticked: boolean) => void
  /** Writes the hold for a run that has none. */
  writeHold: () => void
  /** Each answers whether what was typed reached the hold. */
  chat: (proposal: string, message: string) => Promise<boolean>
  askRoom: (question: string) => Promise<boolean>
  change: (text: string) => Promise<boolean>
  /** Each rerun tells `onProgress` what it writes again, and each step the engine starts. */
  revise: (turn: RepliedTurn, onProgress: OnRerunProgress) => Promise<void>
  /** Answers whether the proposal’s new words reached the hold. */
  editProposal: (proposal: string, text: string) => Promise<boolean>
  /** Reruns downstream of every edited proposal. */
  rerun: (onProgress: OnRerunProgress) => Promise<void>
  /** Answers the hold and carries the run on; `undefined` when nothing ran. */
  resume: (runId: string) => Promise<Resumed | undefined>
  /** Answers whether the side quest's result reached the hold. */
  sideQuest: (proposal: string, chain: string) => Promise<boolean>
  /** The chains a side quest can go through; none while the engine cannot say. */
  chains: () => Promise<string[]>
  runUrl: (runId: string) => string | undefined
  /** Opens an editor on a proposal's words, which reports every change. */
  openEditor: (text: string, changed: () => void) => ProposalEditor
  openMenu: (event: MouseEvent) => void
  now: () => number
  /** Calls `tick` every `ms`; returns what stops it. */
  every: (ms: number, tick: () => void) => () => void
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
  /** Each run's rerun, while it goes. */
  private readonly rerunning = new Map<string, Rerun>()
  /** Each run's resume, while it goes and once it has landed. */
  private readonly resumes = new Map<string, ResumeShown>()
  /** Each proposal being edited, by `editKey`. */
  private readonly edits = new Map<string, OpenEdit>()
  /** The chains the engine named when a tab was last opened. */
  private chains: string[] = []
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

  /** Lets go of every open editor; the panel is going away. */
  close(): void {
    for (const key of [...this.edits.keys()]) this.closeEdit(key)
  }

  /** Redraws what the hold now says, keeping the reader's tab and scroll. */
  draw(state: DirectingState): void {
    this.state = state
    if (state.kind === 'hold') this.followHold(state.hold)
    const scroll = this.body?.scrollTop ?? 0
    const typing = [...this.edits.values()].find(edit => edit.editor.hasFocus())
    const keepTyping = this.boxes.keepTyping(this.root)
    this.releases.forEach(release => release())
    this.releases = []
    this.root.replaceChildren()
    this.root.classList.add(CLS)

    this.header()
    const body = (this.body = this.add(this.root, 'div', `${CLS}-body`))
    if (state.kind === 'idle') this.add(body, 'div', `${CLS}-empty`, 'Click a card, or a run’s ✎ Direct, on the drawing.')
    if (state.kind === 'missing') this.missing(body, state.runId)
    if (state.kind === 'hold') {
      this.hold(body, state.hold)
      this.resumeBar(state.hold)
    }
    body.scrollTop = scroll
    keepTyping()
    typing?.editor.focus()
  }

  /** A hold a rerun moved takes what the panel held under its earlier runs: an open edit, and the rerun still going. */
  private followHold(hold: HoldReading): void {
    for (const earlier of hold.earlierRuns) {
      const going = this.rerunning.get(earlier)
      this.rerunning.delete(earlier)
      if (going && !this.rerunning.has(hold.runId)) this.rerunning.set(hold.runId, going)
      const prefix = editKey(earlier, '')
      for (const [key, edit] of [...this.edits]) {
        if (!key.startsWith(prefix)) continue
        const moved = editKey(hold.runId, key.slice(prefix.length))
        if (this.edits.has(moved)) this.closeEdit(key)
        else {
          this.edits.delete(key)
          this.edits.set(moved, edit)
        }
      }
    }
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
    const row = this.add(body, 'div', `${CLS}-tabs`)
    const tabs = this.add(row, 'div', `${CLS}-tablist`)
    tabs.setAttribute('role', 'tablist')
    this.tabButton(tabs, 'Run', undefined, !proposal)
    for (const one of hold.proposals) this.tabButton(tabs, one.name, one.name, one === proposal, one.edited)
    this.rerunButton(row, hold)
    const going = this.rerunning.get(hold.runId)
    const rewritten = proposal !== undefined && going?.progress?.proposals.includes(proposal.name) === true
    if (going && rewritten) this.progress(body, going)

    if (!proposal) {
      for (const waiting of hold.holds) this.waitingAt(body, waiting)
      this.verdict(body, hold)
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
    const key = editKey(hold.runId, proposal.name)
    const edit = this.edits.get(key)
    if (edit) this.drawEditor(top, key, proposal.name, edit)
    else this.proposalText(top, hold.runId, proposal.name, proposal.text, rewritten)
    const canon = hold.canon.filter(line => line.proposer === proposal.name)
    if (canon.length > 0) this.canon(this.section(body, 'Canon from this proposal'), canon, false)
    this.chat(this.section(body, `Chat with ${proposal.name}`), hold, proposal.name)
    this.sideQuests(this.section(body, 'Side quest'), hold, proposal.name)
  }

  private sideQuests(el: HTMLElement, hold: HoldReading, name: string): void {
    el.classList.add(`${CLS}-quests`)
    const key = boxKey(hold.runId, `quest ${name}`)
    for (const quest of hold.conversation) {
      if (quest.kind !== 'quest' || quest.name !== name) continue
      const shown = this.turn(el, `Sent through ${quest.chainName}`)
      if (quest.runId === undefined) {
        this.add(shown, 'div', `${CLS}-faint`, 'No result')
        continue
      }
      this.markdown(shown, quest.result || '*The run gave no result.*')
      this.runLink(shown, quest.runId)
    }
    const pending = this.boxes.waiting(key)
    if (pending !== undefined) this.add(this.turn(el, `Sent through ${pending}`), 'div', `${CLS}-faint`, `${pending} is running…`)
    if (this.edits.has(editKey(hold.runId, name))) this.add(el, 'div', `${CLS}-faint`, 'Sends the proposal as last saved')
    this.boxes.draw(el, {
      key,
      placeholder: 'Chain to send it through…',
      label: 'Go',
      choices: this.chains,
      send: chain => this.deps.sideQuest(name, chain),
    })
  }

  private runLink(el: HTMLElement, runId: string): void {
    const link = this.add(el, 'a', `${CLS}-run-link`, `→ run ${shortId(runId)}`)
    link.title = `run ${runId}`
    const url = this.deps.runUrl(runId)
    if (!url) return
    link.href = url
    link.target = '_blank'
    link.rel = 'noopener'
  }

  /** Kept until the engine names chains again, so an engine gone offline leaves the last list to pick from. */
  private async askForChains(): Promise<void> {
    const names = await this.deps.chains()
    if (names.length === 0 || names.join('\n') === this.chains.join('\n')) return
    this.chains = names
    this.draw(this.state)
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
      else if (turn.reply !== undefined) {
        this.reviseButton(shown, hold, { name, message: turn.message, reply: turn.reply, ...(turn.turn !== undefined ? { turn: turn.turn } : {}) })
      }
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

  private reviseButton(el: HTMLElement, hold: HoldReading, turn: RepliedTurn): void {
    const going = this.rerunning.get(hold.runId)?.from
    const label = going?.kind === 'reply' && sameTurn(going.turn, turn) ? 'Rerunning…' : 'Use this reply as the revision & rerun'
    const button = this.button(el, label, `${CLS}-quiet`)
    button.disabled = !this.canRerun(hold)
    button.addEventListener('click', () => void this.startRerun(hold, { kind: 'reply', turn }, onProgress => this.deps.revise(turn, onProgress)))
  }

  /** Pinned under every tab: the Direction run as it stands, and what the last run of it landed on. */
  private resumeBar(hold: HoldReading): void {
    const bar = this.add(this.root, 'div', `${CLS}-footer`)
    const shown = this.resumes.get(hold.runId)
    const running = shown?.kind === 'running'
    const button = this.button(bar, running ? 'Resuming…' : resumeLabel(hold.canon), 'mod-cta')
    button.disabled = running
    button.addEventListener('click', () => void this.startResume(hold.runId))
    if (shown?.kind === 'stopped') this.add(bar, 'div', `${CLS}-faint`, 'Resume did not run.')
    if (shown?.kind === 'landed') this.resumeStatus(bar, shown.result)
  }

  private resumeStatus(bar: HTMLElement, result: Resumed): void {
    const line = this.add(bar, 'div', `${CLS}-resumed`)
    const failed = result.error !== undefined
    const said = failed ? `Failed: ${result.error}` : 'Resumed'
    const canon = canonNote(result.canon)
    this.add(line, 'span', failed ? `${CLS}-failed` : `${CLS}-faint`, canon ? `${said} · ${canon}` : said)
    if (result.runId) this.runLink(line, result.runId)
  }

  /** One resume at a time per run. */
  private async startResume(runId: string): Promise<void> {
    if (this.resumes.get(runId)?.kind === 'running') return
    this.resumes.set(runId, { kind: 'running' })
    this.draw(this.state)
    let outcome: ResumeShown = { kind: 'stopped' }
    try {
      const result = await this.deps.resume(runId)
      if (result) outcome = { kind: 'landed', result }
    } finally {
      this.resumes.set(runId, outcome)
      this.draw(this.state)
    }
  }

  /** At the end of the tab row, once a proposal is edited; the edited ones are marked on their tabs. */
  private rerunButton(row: HTMLElement, hold: HoldReading): void {
    if (!hold.proposals.some(one => one.edited)) return
    const going = this.rerunning.get(hold.runId)?.from
    const button = this.button(row, going?.kind === 'edits' ? 'Rerunning…' : '⟳ Rerun downstream', `mod-cta ${CLS}-rerun`)
    button.disabled = !this.canRerun(hold)
    if (this.editOpen(hold)) button.title = 'Save or cancel the edit first'
    button.addEventListener('click', () => void this.startRerun(hold, { kind: 'edits' }, onProgress => this.deps.rerun(onProgress)))
  }

  /** One rerun at a time per run, and none while an edit is open: the run it lands on would leave the edit behind. */
  private canRerun(hold: HoldReading): boolean {
    return !this.rerunning.has(hold.runId) && !this.editOpen(hold)
  }

  /** Whether a rerun going may write `name` again: until it has said which it writes, any proposal may be. */
  private rewriting(runId: string, name: string): boolean {
    const going = this.rerunning.get(runId)
    if (!going) return false
    return going.progress ? going.progress.proposals.includes(name) : true
  }

  private editOpen(hold: HoldReading): boolean {
    return hold.proposals.some(one => this.edits.has(editKey(hold.runId, one.name)))
  }

  /**
   * A rerun that writes the verdict again greys the old one under what it is doing,
   * until the run it lands on replaces it. Until it says, it is taken to.
   */
  private verdict(body: HTMLElement, hold: HoldReading): void {
    const going = this.rerunning.get(hold.runId)
    const rewriting = going !== undefined && going.progress?.verdict !== false
    if (!hold.verdict && !rewriting) return
    const section = this.section(body, 'Verdict')
    if (rewriting) this.progress(section, going)
    if (!hold.verdict) return
    const old = this.add(section, 'div', `${CLS}-verdict`)
    old.classList.toggle('is-stale', going?.progress?.verdict === true)
    this.markdown(old, hold.verdict)
  }

  /** The step a rerun is on, and how long it has gone. */
  private progress(el: HTMLElement, going: Rerun): void {
    const line = this.add(el, 'div', `${CLS}-progress`)
    const doing = rerunDoing(going.progress?.step)
    const show = (): void => {
      line.textContent = `${doing} ${elapsed(this.deps.now() - going.startedAt)}`
    }
    show()
    this.releases.push(this.deps.every(1000, show))
  }

  private async startRerun(hold: HoldReading, from: RerunFrom, rerun: (onProgress: OnRerunProgress) => Promise<void>): Promise<void> {
    const runId = hold.runId
    if (!this.canRerun(hold)) return
    const going: Rerun = { from, startedAt: this.deps.now() }
    this.rerunning.set(runId, going)
    this.draw(this.state)
    const onProgress = (progress: RerunProgress): void => {
      going.progress = progress
      this.draw(this.state)
    }
    try {
      await rerun(onProgress)
    } finally {
      // By identity: the hold may have moved it to the run it landed on.
      for (const [key, one] of [...this.rerunning]) if (one === going) this.rerunning.delete(key)
      this.draw(this.state)
    }
  }

  private tabButton(tabs: HTMLElement, label: string, proposal: string | undefined, selected: boolean, edited = false): void {
    const tab = this.button(tabs, label, selected ? 'is-selected' : '')
    tab.classList.toggle('is-edited', edited)
    if (edited) tab.title = 'Edited since the run'
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-selected', String(selected))
    tab.addEventListener('click', () => this.showTab(this.state, proposal))
  }

  private showTab(state: DirectingState, proposal: string | undefined): void {
    this.tab = proposal
    this.draw(state)
    if (this.body) this.body.scrollTop = 0
    void this.askForChains()
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

  /** A `stale` proposal is being written again, so it is shown greyed. */
  private proposalText(el: HTMLElement, runId: string, name: string, text: string, stale: boolean): void {
    const shown = this.add(el, 'div', `${CLS}-proposal`)
    shown.classList.toggle('is-stale', stale)
    this.markdown(shown, text || '*This proposal is empty.*')
    const whole = this.unclamped.has(name)
    shown.classList.toggle('is-clamped', !whole)
    const actions = this.add(el, 'div', `${CLS}-proposal-actions`)
    const toggle = this.button(actions, whole ? 'Show less' : 'Show the whole proposal', `${CLS}-quiet`)
    toggle.hidden = !whole
    const edit = this.button(actions, '✎ Edit', `${CLS}-quiet`)
    edit.disabled = this.rewriting(runId, name)
    edit.addEventListener('click', () => {
      const key = editKey(runId, name)
      const open: OpenEdit = { editor: this.deps.openEditor(text, () => open.refreshSave()), saving: false, refreshSave: () => {} }
      this.edits.set(key, open)
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

  /** The editor outlives the redraw, so it is put back rather than made again. */
  private drawEditor(el: HTMLElement, key: string, name: string, edit: OpenEdit): void {
    const frame = this.add(el, 'div', `${CLS}-editor`)
    frame.append(edit.editor.el)
    const row = this.add(frame, 'div', `${CLS}-editor-actions`)
    const save = this.button(row, 'Save', 'mod-cta')
    const savable = (): boolean => !edit.saving && edit.editor.text().trim() !== ''
    save.disabled = !savable()
    edit.refreshSave = () => void (save.disabled = !savable())
    save.addEventListener('click', () => void this.save(key, name))
    this.button(row, 'Cancel', '').addEventListener('click', () => {
      this.closeEdit(key)
      this.draw(this.state)
    })
  }

  private closeEdit(key: string): void {
    this.edits.get(key)?.editor.destroy()
    this.edits.delete(key)
  }

  private async save(key: string, name: string): Promise<void> {
    const edit = this.edits.get(key)
    if (!edit || edit.saving) return
    edit.saving = true
    this.draw(this.state)
    try {
      // By identity: a rerun landing meanwhile moves the edit to the run it landed on.
      if (await this.deps.editProposal(name, edit.editor.text())) {
        const now = [...this.edits].find(([, one]) => one === edit)?.[0]
        if (now) this.closeEdit(now)
      }
    } finally {
      edit.saving = false
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

  /** A hold the run waits at: its question, and a checkbox per candidate. */
  private waitingAt(body: HTMLElement, hold: HoldPick): void {
    const el = this.section(body, `Waiting at ${hold.nodeId}`)
    el.classList.add(`${CLS}-hold`)
    if (hold.prompt) this.add(el, 'div', '', hold.prompt)
    if (hold.candidates.length === 0) this.add(el, 'div', `${CLS}-faint`, 'No candidates')
    for (const candidate of hold.candidates) {
      this.checkbox(el, candidate.heading, candidate.ticked, ticked => this.deps.tickCandidate(hold.nodeId, candidate.heading, ticked))
      this.markdown(el, candidate.body)
    }
  }

  /** Checkboxes, grouped under who offered each line when more than one proposal is shown. */
  private canon(el: HTMLElement, lines: CanonChoice[], grouped: boolean): void {
    let proposer: string | undefined
    for (const line of lines) {
      if (grouped && line.proposer !== proposer) this.add(el, 'div', `${CLS}-faint`, (proposer = line.proposer))
      this.checkbox(el, line.text, line.ticked, ticked => this.deps.tickCanon(line.id, ticked))
    }
  }

  private checkbox(el: HTMLElement, text: string, ticked: boolean, changed: (ticked: boolean) => void): void {
    const label = this.add(el, 'label', `${CLS}-canon`)
    const box = this.add(label, 'input')
    box.type = 'checkbox'
    box.checked = ticked
    box.addEventListener('change', () => changed(box.checked))
    this.add(label, 'span', '', text)
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

/** A proposal being edited: the live editor, whether its words are on their way to the hold, and how its Save button hears about a change. */
interface OpenEdit {
  editor: ProposalEditor
  saving: boolean
  refreshSave: () => void
}

type ChatEntry = Extract<ConversationEntry, { kind: 'chat' }>

type RerunFrom = { kind: 'edits' } | { kind: 'reply'; turn: RepliedTurn }

/** A rerun going: what it was started from, when, and how it is getting on once it has said. */
interface Rerun {
  from: RerunFrom
  startedAt: number
  progress?: RerunProgress
}

/** A resume from the panel: going, landed, or stopped before it ran. */
type ResumeShown = { kind: 'running' } | { kind: 'landed'; result: Resumed } | { kind: 'stopped' }

/** The button names what the run would lock, so nothing is resumed on ticks the reader forgot. */
function resumeLabel(canon: CanonChoice[]): string {
  if (canon.length === 0) return '▶ Resume'
  return `▶ Resume · ${canon.filter(line => line.ticked).length} of ${canon.length} canon ticked`
}

/** `m:ss` */
function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function editKey(runId: string, proposal: string): string {
  return boxKey(runId, `edit ${proposal}`)
}

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
