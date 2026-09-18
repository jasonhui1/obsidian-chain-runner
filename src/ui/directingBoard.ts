import { canonNote, DIRECTION_VERBS, oneLine, type DirectionVerb, type Hold, type Holds, type Landing, type Resumed } from './holds'
import { KeyedTree } from './keyedTree'
import type { ProposalEditor } from './proposalEditor'
import { TypingBoxes, type TypingBox } from './typingBoxes'
import { sameTurn, type RepliedTurn } from '../run/chat'
import type { ConversationEntry } from '../run/conversation'
import { rerunDoing } from '../run/rerunProgress'
import type { GoingRerun, RerunWatch } from '../run/rerunWatch'

/**
 * The directing panel: one run's hold, drawn from what the hold module answers,
 * read again when the note changes by any hand, and followed to wherever a
 * rerun or a resume lands it. Plain DOM, drawn by key (ADR-0007): an element a
 * draw still wants is kept and updated, so nothing typed or focused is put back.
 * Every button is one hold module call.
 */

export interface DirectingBoardDeps {
  holds: Holds
  /** Every rerun going, wherever it was started, and the time its start is told by. */
  reruns: Pick<RerunWatch, 'going' | 'onChange' | 'now'>
  /** The chains a side quest can go through; none while the engine cannot say. */
  chains: () => Promise<string[]>
  /** Where a run is shown on the engine, as it is set now (ADR-0004). */
  runUrl: (runId: string) => string | undefined
  /** Renders markdown into an empty element, returning what releases the render. */
  renderMarkdown: (text: string, into: HTMLElement) => () => void
  /** Opens an editor on a proposal's words, which reports every change. */
  openEditor: (text: string, changed: () => void) => ProposalEditor
  openMenu: (event: MouseEvent, items: MenuItem[]) => void
  clock: Clock
  /** Reports whether `frame` cuts its content off, now and whenever that changes; returns what stops it. */
  watchOverflow: (frame: HTMLElement, changed: (overflowing: boolean) => void) => () => void
}

export interface MenuItem {
  title: string
  icon: string
  click: () => void
}

export interface Clock {
  /** Calls `tick` every `ms`; returns what stops it. */
  every: (ms: number, tick: () => void) => () => void
}

type DirectingState =
  | { kind: 'idle' }
  | { kind: 'missing'; runId: string }
  | { kind: 'hold'; hold: Hold }

const CLS = 'chain-runner-directing'

export class DirectingBoard {
  private state: DirectingState = { kind: 'idle' }
  /** The proposal whose tab is open; `undefined` is the Run tab. */
  private tab: string | undefined
  private readonly unclamped = new Set<string>()
  private readonly boxes = new TypingBoxes(() => this.redraw())
  /** What the panel holds for each run beyond its note, moved on with the hold when it lands elsewhere. */
  private readonly runs = new Map<string, RunShown>()
  /** The chains the engine named when a tab was last opened. */
  private chains: string[] = []
  private readonly tree = new KeyedTree()
  /** The words each markdown element shows, so words that did not change are not rendered again. */
  private readonly rendered = new WeakMap<HTMLElement, string>()
  /** Numbers the edits opened, so a new one gets a frame of its own. */
  private opened = 0
  private body: HTMLElement | undefined
  private listening: { runId: string; stop: () => void } | undefined
  /** Stops hearing the reruns, heard while the panel shows a run. */
  private stopWatching: (() => void) | undefined
  /** Counts draws, so a slow read overtaken by a later draw draws nothing. */
  private draws = 0

  constructor(
    private readonly root: HTMLElement,
    private readonly deps: DirectingBoardDeps,
  ) {
    root.classList.add(CLS)
    this.redraw()
  }

  /** Shows a run afresh, on the named proposal's tab or else the Run tab; `hold` is what the hold module answered for it. */
  show(runId: string, hold: Hold | undefined, proposal?: string): void {
    this.unclamped.clear()
    this.tab = proposal
    this.draw(stateOf(hold, runId))
    this.tabOpened()
  }

  /** Lets go of the run shown and every open editor; the panel is going away. */
  close(): void {
    for (const shown of this.runs.values()) for (const edit of shown.edits.values()) edit.editor.destroy()
    this.runs.clear()
    this.stopWatching?.()
    this.stopWatching = undefined
    this.draw({ kind: 'idle' })
  }

  /** Draws `state`, keeping the reader's tab, and follows its run and every rerun. */
  private draw(state: DirectingState): void {
    ++this.draws
    this.state = state
    if (state.kind === 'hold') this.follow(state.hold)
    this.listen(runIdOf(state))
    if (state.kind !== 'idle') this.stopWatching ??= this.deps.reruns.onChange(() => this.redraw())
    this.redraw()
  }

  private redraw(): void {
    const state = this.state
    this.header()
    const body = (this.body = this.add(this.root, 'div', `${CLS}-body`))
    if (state.kind === 'idle') this.add(body, 'div', `${CLS}-empty`, 'Click a card, or a run’s ✎ Direct, on the drawing.')
    if (state.kind === 'missing') this.missing(body, state.runId)
    if (state.kind === 'hold') {
      this.hold(body, state.hold)
      this.resumeBar(state.hold)
    }
    this.tree.end()
  }

  /** Hears the note of the run shown, by any hand, and draws it again. */
  private listen(runId: string | undefined): void {
    if (runId === this.listening?.runId) return
    this.listening?.stop()
    this.listening = runId === undefined ? undefined : { runId, stop: this.deps.holds.onChange(runId, () => void this.reread(runId)) }
  }

  private async reread(runId: string): Promise<void> {
    const draws = this.draws
    const hold = await this.deps.holds.read(runId)
    if (draws === this.draws) this.draw(stateOf(hold, runId))
  }

  /** A call on the run shown; what it answered is drawn, unless the panel moved on meanwhile. Whether it wrote anything. */
  private async act(call: (runId: string) => Promise<Hold | undefined>): Promise<boolean> {
    const runId = runIdOf(this.state)
    return runId !== undefined && this.landed(runId, await call(runId))
  }

  private landed(from: string, hold: Hold | undefined): boolean {
    if (!hold) return false
    const shown = runIdOf(this.state)
    if (shown === from || shown === hold.runId) this.draw({ kind: 'hold', hold })
    return true
  }

  /** What the panel holds for `runId`, made when it holds nothing yet. */
  private shownFor(runId: string): RunShown {
    let shown = this.runs.get(runId)
    if (!shown) this.runs.set(runId, (shown = { edits: new Map() }))
    return shown
  }

  /** What is going on the hold, found by its earlier runs too while a rerun lands it on a new one. */
  private going(hold: Hold): GoingRerun | undefined {
    for (const runId of [hold.runId, ...hold.earlierRuns]) {
      const going = this.deps.reruns.going(runId)
      if (going) return going
    }
    return undefined
  }

  /** The hold's rerun or revise, while it goes; a resume is said in the footer instead. */
  private rerunning(hold: Hold): GoingRerun | undefined {
    const going = this.going(hold)
    return going?.cause.kind === 'resume' ? undefined : going
  }

  private resuming(hold: Hold): GoingRerun | undefined {
    const going = this.going(hold)
    return going?.cause.kind === 'resume' ? going : undefined
  }

  /** The run's open edit of a proposal. */
  private editing(runId: string, proposal: string): OpenEdit | undefined {
    return this.runs.get(runId)?.edits.get(proposal)
  }

  /** A hold that landed on another run takes the edits the panel held open under its earlier runs. */
  private follow(hold: Hold): void {
    for (const earlier of hold.earlierRuns) {
      const was = this.runs.get(earlier)
      if (!was) continue
      this.runs.delete(earlier)
      const now = this.shownFor(hold.runId)
      for (const [name, edit] of was.edits) {
        if (now.edits.has(name)) edit.editor.destroy()
        else now.edits.set(name, edit)
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
    const { runId: shown } = this.state.hold
    more.onclick = (event): void => this.deps.openMenu(event, [{ title: 'Open the hold note in a tab', icon: 'file-text', click: () => void this.deps.holds.open(shown) }])
  }

  private missing(body: HTMLElement, runId: string): void {
    this.add(body, 'div', `${CLS}-empty`, `Run ${runId} has no hold note yet.`)
    this.button(body, '✎ Direct this run', 'mod-cta').onclick = (): void => void this.act(runId => this.deps.holds.write(runId))
  }

  private hold(body: HTMLElement, hold: Hold): void {
    const proposal = hold.proposals.find(one => one.name === this.tab)
    const row = this.add(body, 'div', `${CLS}-tabs`)
    const tabs = this.add(row, 'div', `${CLS}-tablist`)
    tabs.setAttribute('role', 'tablist')
    this.tabButton(tabs, 'Run', undefined, !proposal)
    for (const one of hold.proposals) this.tabButton(tabs, one.name, one.name, one === proposal, one.edited)
    this.rerunButton(row, hold)
    const going = this.rerunning(hold)
    const rewritten = proposal !== undefined && going?.progress?.proposals.includes(proposal.name) === true
    if (going && rewritten) this.progress(body, going)

    if (!proposal) {
      for (const waiting of hold.holds) this.waitingAt(body, waiting)
      this.verdict(body, hold)
      const direction = this.section(body, 'direction', 'Direction so far')
      this.directionSoFar(direction, hold.direction)
      this.box(direction, {
        key: boxKey(hold.runId, 'change'),
        placeholder: 'What should change…',
        label: 'Add',
        send: text => this.act(runId => this.deps.holds.change(runId, text)),
      })
      this.room(this.section(body, 'room', 'Ask the room'), hold)
      const ticked = hold.canon.filter(line => line.ticked).length
      if (hold.canon.length > 0) this.canon(this.section(body, 'canon', `Canon · ${ticked} of ${hold.canon.length} ticked`), hold.canon, true)
      return
    }

    const top = this.section(body, `${proposal.name} top`)
    this.verbs(top, proposal, hold.proposals.map(one => one.name).filter(name => name !== proposal.name))
    const edit = this.editing(hold.runId, proposal.name)
    if (edit) this.drawEditor(top, proposal.name, edit)
    else this.proposalText(top, hold, proposal.name, proposal.text, rewritten)
    const canon = hold.canon.filter(line => line.proposer === proposal.name)
    if (canon.length > 0) this.canon(this.section(body, `${proposal.name} canon`, 'Canon from this proposal'), canon, false)
    this.chat(this.section(body, `${proposal.name} chat`, `Chat with ${proposal.name}`), hold, proposal.name)
    this.sideQuests(this.section(body, `${proposal.name} quests`, 'Side quest'), hold, proposal.name)
  }

  private sideQuests(el: HTMLElement, hold: Hold, name: string): void {
    el.classList.add(`${CLS}-quests`)
    const key = boxKey(hold.runId, `quest ${name}`)
    const pending = this.boxes.waiting(key)
    const quests = hold.conversation.filter((entry): entry is QuestEntry => entry.kind === 'quest' && entry.name === name)
    const sent = sentEntry(quests, pending, quest => quest.runId === undefined && quest.chainName)
    for (const quest of quests) {
      const shown = this.turn(el, `Sent through ${quest.chainName}`)
      if (quest.runId === undefined) {
        this.add(shown, 'div', `${CLS}-faint`, quest === sent ? `${quest.chainName} is running…` : 'No result')
        continue
      }
      this.markdown(shown, quest.result || '*The run gave no result.*')
      this.runLink(shown, quest.runId)
    }
    if (pending !== undefined && !sent) this.add(this.turn(el, `Sent through ${pending}`), 'div', `${CLS}-faint`, `${pending} is running…`)
    if (this.editing(hold.runId, name)) this.add(el, 'div', `${CLS}-faint`, 'Sends the proposal as last saved')
    this.box(el, {
      key,
      placeholder: 'Chain to send it through…',
      label: 'Go',
      choices: this.chains,
      send: chain => this.act(runId => this.deps.holds.sideQuest(runId, name, chain)),
    })
  }

  private runLink(el: HTMLElement, runId: string): void {
    const link = this.add(el, 'a', `${CLS}-run-link`, `→ run ${shortId(runId)}`)
    link.title = `run ${runId}`
    const url = this.deps.runUrl(runId)
    if (!url) {
      for (const attribute of ['href', 'target', 'rel']) link.removeAttribute(attribute)
      return
    }
    link.href = url
    link.target = '_blank'
    link.rel = 'noopener'
  }

  /** Kept until the engine names chains again, so an engine gone offline leaves the last list to pick from. */
  private async askForChains(): Promise<void> {
    const names = await this.deps.chains()
    if (names.length === 0 || names.join('\n') === this.chains.join('\n')) return
    this.chains = names
    this.redraw()
  }

  private chat(el: HTMLElement, hold: Hold, name: string): void {
    const key = boxKey(hold.runId, `chat ${name}`)
    const turns = hold.conversation.filter((entry): entry is ChatEntry => entry.kind === 'chat' && entry.name === name)
    const pending = this.boxes.waiting(key)
    const sent = sentEntry(turns, pending, turn => turn.reply === undefined && turn.message)
    if (turns.length === 0 && pending === undefined) this.add(el, 'div', `${CLS}-faint`, `Nothing said to ${name} yet`)
    for (const turn of turns) {
      const shown = this.turn(el, turn.message)
      if (turn.reply === undefined) this.add(shown, 'div', `${CLS}-faint`, turn === sent ? `${name} is replying…` : 'No reply')
      else this.markdown(shown, turn.reply)
      if (turn.revisedAs) this.add(shown, 'div', `${CLS}-faint`, `Used as the revision · run ${shortId(turn.revisedAs)}`)
      else if (turn.reply !== undefined) {
        this.reviseButton(shown, hold, { name, message: turn.message, reply: turn.reply, ...(turn.turn !== undefined ? { turn: turn.turn } : {}) })
      }
    }
    if (pending !== undefined && !sent) this.add(this.turn(el, pending), 'div', `${CLS}-faint`, `${name} is replying…`)
    this.box(el, { key, placeholder: `Message ${name}…`, label: 'Send', send: text => this.act(runId => this.deps.holds.chat(runId, name, text)) })
  }

  private room(el: HTMLElement, hold: Hold): void {
    const key = boxKey(hold.runId, 'room')
    const pending = this.boxes.waiting(key)
    const questions = hold.conversation.filter((entry): entry is RoomEntry => entry.kind === 'room')
    const sent = sentEntry(questions, pending, entry => entry.answers.length === 0 && entry.question)
    for (const entry of questions) {
      const shown = this.turn(el, entry.question)
      if (entry.answers.length === 0) this.add(shown, 'div', `${CLS}-faint`, entry === sent ? 'The room is answering…' : 'No answers')
      for (const answer of entry.answers) {
        this.add(shown, 'div', `${CLS}-answerer`, answer.name)
        this.markdown(shown, answer.answer)
      }
    }
    if (pending !== undefined && !sent) this.add(this.turn(el, pending), 'div', `${CLS}-faint`, 'The room is answering…')
    this.box(el, { key, placeholder: 'Ask every proposal…', label: 'Ask', send: text => this.act(runId => this.deps.holds.askRoom(runId, text)) })
  }

  /** One exchange: what was said, with whatever came back added under it by the caller. */
  private turn(el: HTMLElement, said: string): HTMLElement {
    const turn = this.add(el, 'div', `${CLS}-turn`)
    this.add(turn, 'div', `${CLS}-said`, said)
    return turn
  }

  private reviseButton(el: HTMLElement, hold: Hold, turn: RepliedTurn): void {
    const going = this.rerunning(hold)?.cause
    const label = going?.kind === 'reply' && sameTurn(going.turn, turn) ? 'Rerunning…' : 'Use this reply as the revision & rerun'
    const button = this.button(el, label, `${CLS}-quiet`)
    button.disabled = !this.canRerun(hold)
    button.onclick = (): void => void this.startRerun(hold, runId => this.deps.holds.revise(runId, turn))
  }

  /** Pinned under every tab: the Direction run as it stands, and what the last run of it landed on. */
  private resumeBar(hold: Hold): void {
    const bar = this.add(this.root, 'div', `${CLS}-footer`)
    const resuming = this.resuming(hold)
    const button = this.button(bar, resuming ? 'Resuming…' : resumeLabel(hold.canon), 'mod-cta')
    button.disabled = this.going(hold) !== undefined
    button.onclick = (): void => void this.startResume(hold)
    if (resuming) {
      if (resuming.progress?.step) this.add(bar, 'div', `${CLS}-progress`, rerunDoing(resuming.progress.step))
      return
    }
    const shown = this.runs.get(hold.runId)?.resume
    if (shown?.kind === 'stopped') this.add(bar, 'div', `${CLS}-faint`, 'Resume did not run.')
    if (shown?.kind === 'landed') this.resumeStatus(bar, shown.result)
  }

  private resumeStatus(bar: HTMLElement, result: Resumed): void {
    const line = this.add(bar, 'div', `${CLS}-resumed`)
    const failed = result.error !== undefined
    const said = failed ? `Failed: ${result.error}` : 'Resumed'
    const canon = canonNote(result.canon)
    this.add(line, 'span', failed ? `${CLS}-failed` : `${CLS}-faint`, canon ? `${said} · ${canon}` : said)
    this.runLink(line, result.hold.runId)
  }

  /** One resume at a time per run; the panel follows the hold to the run it carried on as. */
  private async startResume(hold: Hold): Promise<void> {
    if (this.going(hold)) return
    const { runId } = hold
    const shown = this.shownFor(runId)
    let outcome: ResumeShown = { kind: 'stopped' }
    try {
      const result = await this.deps.holds.resume(runId)
      if (result) outcome = { kind: 'landed', result }
    } finally {
      shown.resume = outcome
      // A fork is shown as its own hold, which says what landed it — unless the panel let go of the run meanwhile.
      if (outcome.kind === 'landed' && [...this.runs.values()].includes(shown)) this.shownFor(outcome.result.hold.runId).resume = outcome
      if (outcome.kind !== 'landed' || !this.landed(runId, outcome.result.hold)) this.redraw()
    }
  }

  /** At the end of the tab row, once a proposal is edited; the edited ones are marked on their tabs. */
  private rerunButton(row: HTMLElement, hold: Hold): void {
    if (!hold.proposals.some(one => one.edited)) return
    const going = this.rerunning(hold)?.cause
    const button = this.button(row, going?.kind === 'edits' ? 'Rerunning…' : '⟳ Rerun downstream', `mod-cta ${CLS}-rerun`)
    button.disabled = !this.canRerun(hold)
    titled(button, this.editOpen(hold) ? 'Save or cancel the edit first' : undefined)
    button.onclick = (): void => void this.startRerun(hold, runId => this.deps.holds.rerun(runId))
  }

  /** One rerun or resume at a time per run, and no rerun while an edit is open: the run it lands on would leave the edit behind. */
  private canRerun(hold: Hold): boolean {
    return !this.going(hold) && !this.editOpen(hold)
  }

  /** Whether a rerun going may write `name` again: until it has said which it writes, any proposal may be. */
  private rewriting(hold: Hold, name: string): boolean {
    const going = this.rerunning(hold)
    if (!going) return false
    return going.progress ? going.progress.proposals.includes(name) : true
  }

  private editOpen(hold: Hold): boolean {
    return hold.proposals.some(one => this.editing(hold.runId, one.name))
  }

  /**
   * A rerun that writes the verdict again greys the old one under what it is doing,
   * until the run it lands on replaces it. Until it says, it is taken to.
   */
  private verdict(body: HTMLElement, hold: Hold): void {
    const going = this.rerunning(hold)
    const rewriting = going !== undefined && going.progress?.verdict !== false
    if (!hold.verdict && !rewriting) return
    const section = this.section(body, 'verdict', 'Verdict')
    if (rewriting) this.progress(section, going)
    if (!hold.verdict) return
    const old = this.add(section, 'div', `${CLS}-verdict`)
    old.classList.toggle('is-stale', going?.progress?.verdict === true)
    this.markdown(old, hold.verdict)
  }

  /** The step a rerun is on, and how long it has gone; the line keeps one timer while it is shown. */
  private progress(el: HTMLElement, going: GoingRerun): void {
    const { el: line, fresh } = this.tree.place(el, 'div', `${CLS}-progress`)
    const doing = rerunDoing(going.progress?.step)
    const tick = this.tree.latest(line, () => void (line.textContent = `${doing} ${elapsed(this.deps.reruns.now() - going.startedAt)}`))
    tick()
    if (fresh) this.tree.bind(line, this.deps.clock.every(1000, tick))
  }

  /** The panel follows the hold to the run the rerun lands on. */
  private async startRerun(hold: Hold, rerun: (runId: string) => Promise<Landing | undefined>): Promise<void> {
    if (!this.canRerun(hold)) return
    this.landed(hold.runId, (await rerun(hold.runId))?.hold)
  }

  private tabButton(tabs: HTMLElement, label: string, proposal: string | undefined, selected: boolean, edited = false): void {
    const tab = this.button(tabs, label, '', proposal === undefined ? 'run' : `tab ${proposal}`)
    tab.classList.toggle('is-selected', selected)
    tab.classList.toggle('is-edited', edited)
    titled(tab, edited ? 'Edited since the run' : undefined)
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-selected', String(selected))
    tab.onclick = (): void => {
      this.tab = proposal
      this.redraw()
      this.tabOpened()
    }
  }

  /** A tab just opened shows its top, and the chains the engine names now. */
  private tabOpened(): void {
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
      const button = this.button(row, verb, '', verb)
      button.classList.toggle('is-given', given)
      button.setAttribute('aria-pressed', String(given))
      button.onclick = (): void => this.direct(given, verb, proposal.name)
    }
  }

  private combine(row: HTMLElement, proposal: HoldProposal, others: string[]): void {
    const select = this.add(row, 'select', 'dropdown')
    select.classList.toggle('is-given', proposal.combinedWith.length > 0)
    select.disabled = others.length === 0
    this.option(select, '', 'COMBINE…')
    for (const other of others) this.option(select, other, `${proposal.combinedWith.includes(other) ? '✓' : '+'} ${other}`)
    select.value = ''
    select.onchange = (): void => {
      const other = select.value
      if (!other) return
      this.direct(proposal.combinedWith.includes(other), 'COMBINE', proposal.name, other)
    }
  }

  /** A verb given, or taken back when it was. */
  private direct(given: boolean, verb: DirectionVerb, proposal: string, other?: string): void {
    const { holds } = this.deps
    void this.act(runId => (given ? holds.undirect(runId, verb, proposal, other) : holds.direct(runId, verb, proposal, other)))
  }

  private option(select: HTMLSelectElement, value: string, label: string): void {
    const option = this.add(select, 'option', '', label, `option ${value}`)
    option.value = value
  }

  /** A `stale` proposal is being written again, so it is shown greyed. */
  private proposalText(el: HTMLElement, hold: Hold, name: string, text: string, stale: boolean): void {
    const { runId } = hold
    const { el: shown, fresh } = this.tree.place(el, 'div', `${CLS}-proposal`)
    shown.classList.toggle('is-stale', stale)
    this.markdown(shown, text || '*This proposal is empty.*')
    const whole = this.unclamped.has(name)
    shown.classList.toggle('is-clamped', !whole)
    const actions = this.add(el, 'div', `${CLS}-proposal-actions`)
    const toggle = this.button(actions, whole ? 'Show less' : 'Show the whole proposal', `${CLS}-quiet`)
    const edit = this.button(actions, '✎ Edit', `${CLS}-quiet`)
    edit.disabled = this.rewriting(hold, name)
    edit.onclick = (): void => {
      const open: OpenEdit = { id: ++this.opened, editor: this.deps.openEditor(text, () => open.refreshSave()), saving: false, refreshSave: () => {} }
      this.shownFor(runId).edits.set(name, open)
      this.redraw()
    }
    toggle.onclick = (): void => {
      if (whole) this.unclamped.delete(name)
      else this.unclamped.add(name)
      this.redraw()
    }
    // Shown whole, the toggle is always there to clamp it again.
    const offer = this.tree.latest(shown, () => void (toggle.hidden = !this.unclamped.has(name) && !shown.classList.contains('is-overflowing')))
    if (fresh) {
      const watching = this.deps.watchOverflow(shown, overflowing => {
        shown.classList.toggle('is-overflowing', overflowing)
        offer()
      })
      this.tree.bind(shown, watching)
    }
    offer()
  }

  /** The editor's frame is kept by the edit, so the editor is never moved while it is open (ADR-0012). */
  private drawEditor(el: HTMLElement, name: string, edit: OpenEdit): void {
    const frame = this.add(el, 'div', `${CLS}-editor`, undefined, `editor ${edit.id}`)
    this.tree.use(frame, 'editor', () => edit.editor.el)
    const row = this.add(frame, 'div', `${CLS}-editor-actions`)
    const save = this.button(row, 'Save', 'mod-cta')
    const savable = (): boolean => !edit.saving && edit.editor.text().trim() !== ''
    save.disabled = !savable()
    edit.refreshSave = () => void (save.disabled = !savable())
    save.onclick = (): void => void this.save(name, edit)
    this.button(row, 'Cancel', '').onclick = (): void => {
      this.closeEdit(edit)
      this.redraw()
    }
  }

  /** By identity: a rerun landing moves an edit to the run it landed on. */
  private closeEdit(edit: OpenEdit): void {
    edit.editor.destroy()
    for (const shown of this.runs.values()) for (const [name, one] of shown.edits) if (one === edit) shown.edits.delete(name)
  }

  private async save(name: string, edit: OpenEdit): Promise<void> {
    if (edit.saving) return
    edit.saving = true
    this.redraw()
    try {
      if (await this.act(runId => this.deps.holds.editProposal(runId, name, edit.editor.text()))) this.closeEdit(edit)
    } finally {
      edit.saving = false
      this.redraw()
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
    const el = this.section(body, `waiting ${hold.nodeId}`, `Waiting at ${hold.nodeId}`)
    el.classList.add(`${CLS}-hold`)
    if (hold.prompt) this.add(el, 'div', '', hold.prompt)
    if (hold.candidates.length === 0) this.add(el, 'div', `${CLS}-faint`, 'No candidates')
    for (const candidate of hold.candidates) {
      this.checkbox(el, undefined, candidate.heading, candidate.ticked, ticked =>
        void this.act(runId => this.deps.holds.pickCandidate(runId, hold.nodeId, candidate.heading, ticked)),
      )
      this.markdown(el, candidate.body)
    }
  }

  /** Checkboxes, grouped under who offered each line when more than one proposal is shown. */
  private canon(el: HTMLElement, lines: CanonChoice[], grouped: boolean): void {
    let proposer: string | undefined
    for (const line of lines) {
      if (grouped && line.proposer !== proposer) this.add(el, 'div', `${CLS}-faint`, (proposer = line.proposer))
      this.checkbox(el, `canon ${line.id}`, line.text, line.ticked, ticked => void this.act(runId => this.deps.holds.tickCanon(runId, line.id, ticked)))
    }
  }

  private checkbox(el: HTMLElement, key: string | undefined, text: string, ticked: boolean, changed: (ticked: boolean) => void): void {
    const label = this.add(el, 'label', `${CLS}-canon`, undefined, key)
    const box = this.add(label, 'input')
    box.type = 'checkbox'
    box.checked = ticked
    box.onchange = (): void => changed(box.checked)
    this.add(label, 'span', '', text)
  }

  private section(el: HTMLElement, key: string, title?: string): HTMLElement {
    const section = this.add(el, 'div', `${CLS}-section`, undefined, key)
    if (title) this.add(section, 'div', `${CLS}-section-title`, title)
    return section
  }

  /** A typing box, in a row kept under the box's own key. */
  private box(el: HTMLElement, box: TypingBox): void {
    this.boxes.draw(this.add(el, 'div', '', undefined, box.key), box)
  }

  /** Renders `text` into a kept element, unless that is what it already shows. */
  private markdown(el: HTMLElement, text: string): void {
    const into = this.add(el, 'div', `${CLS}-markdown`)
    if (this.rendered.get(into) === text) return
    this.tree.unbind(into)
    into.replaceChildren()
    this.rendered.set(into, text)
    this.tree.bind(into, this.deps.renderMarkdown(text, into))
  }

  private button(el: HTMLElement, text: string, cls: string, key?: string): HTMLButtonElement {
    return this.add(el, 'button', cls, text, key)
  }

  private add<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls = '', text?: string, key?: string): HTMLElementTagNameMap[K] {
    const { el } = this.tree.place(parent, tag, cls, key)
    if (text !== undefined && el.textContent !== text) el.textContent = text
    return el
  }
}

/** A proposal being edited: the live editor, whether its words are on their way to the hold, and how its Save button hears about a change. */
interface OpenEdit {
  id: number
  editor: ProposalEditor
  saving: boolean
  refreshSave: () => void
}

type ChatEntry = Extract<ConversationEntry, { kind: 'chat' }>
type RoomEntry = Extract<ConversationEntry, { kind: 'room' }>
type QuestEntry = Extract<ConversationEntry, { kind: 'quest' }>
type HoldProposal = Hold['proposals'][number]
type CanonChoice = Hold['canon'][number]
type HoldPick = Hold['holds'][number]

/** What the panel holds for a run beyond its note. */
interface RunShown {
  resume?: ResumeShown
  /** Each proposal being edited, by name. */
  edits: Map<string, OpenEdit>
}

/** How the last resume from the panel ended: landed, or stopped before it ran. */
type ResumeShown = { kind: 'landed'; result: Resumed } | { kind: 'stopped' }

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

/** A kept element's title, set or taken away. */
function titled(el: HTMLElement, title: string | undefined): void {
  if (title === undefined) el.removeAttribute('title')
  else el.title = title
}

function boxKey(runId: string, box: string): string {
  return `${runId} ${box}`
}

/**
 * The entry the note already holds for what a box is sending: the last one,
 * still unanswered, saying what was sent (ADR-0014). `unanswered` answers what it says.
 */
function sentEntry<T>(entries: T[], pending: string | undefined, unanswered: (entry: T) => string | false): T | undefined {
  const last = entries.at(-1)
  return pending !== undefined && last !== undefined && unanswered(last) === oneLine(pending) ? last : undefined
}

function shortId(runId: string): string {
  return runId.split('-').pop() ?? runId
}

function stateOf(hold: Hold | undefined, runId: string): DirectingState {
  return hold ? { kind: 'hold', hold } : { kind: 'missing', runId }
}

function runIdOf(state: DirectingState): string | undefined {
  if (state.kind === 'hold') return state.hold.runId
  return state.kind === 'missing' ? state.runId : undefined
}
