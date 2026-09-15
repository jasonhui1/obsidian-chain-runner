/**
 * PROTOTYPE (#35) — throwaway. Three layouts for directing a run from the right
 * sidebar, switchable from the bar at the panel’s top (or ← → with the panel
 * focused): A per run, B per proposal, C a conversation. Every button goes
 * through `PrototypeHold`, never the note.
 */

import { ItemView, MarkdownRenderer, Menu, type IconName, type MenuItem, type WorkspaceLeaf } from 'obsidian'
import { PrototypeHold, type HoldEvent, type HoldReading } from './holdActions.prototype'
import { DIRECTION_VERBS, type DirectionVerb } from '../run/holdNote'

export const DIRECTING_VIEW_TYPE = 'chain-runner-directing-prototype'

export interface DirectingPanelDeps {
  /** The hold note's content for a run, or `undefined` when none is written yet. */
  loadNote(runId: string): Promise<string | undefined>
  /** The real "Direct this run" write, without opening a tab. */
  writeHold(runId: string): Promise<void>
  fetchPitch(runId: string): Promise<string | undefined>
  chainNames(): Promise<string[]>
  openNote(runId: string): void
}

const VARIANTS = ['A — Run sheet', 'B — Proposal focus', 'C — Conversation'] as const
const ROOM = '__room__'

export class DirectingPanelPrototype extends ItemView {
  private variant = 1
  private runId: string | undefined
  private selected: string | undefined
  private readonly holds = new Map<string, PrototypeHold>()
  private missing = false
  private drawer: 'note' | 'calls' | undefined
  private readonly busy = new Set<string>()
  private readonly drafts = new Map<string, string>()
  private readonly editing = new Set<string>()
  private focusKey: string | undefined
  private chains: string[] = []
  private to = ROOM
  private questing = false
  private openCount = 0
  private readonly folds = new Map<string, boolean>()
  /** Survives Reload and switching runs, so the tally of what got used is kept for the session. */
  private readonly calls: string[] = []

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: DirectingPanelDeps,
  ) {
    super(leaf)
  }

  override getViewType(): string {
    return DIRECTING_VIEW_TYPE
  }

  override getDisplayText(): string {
    return 'Directing (prototype)'
  }

  override getIcon(): IconName {
    return 'clapperboard'
  }

  override async onOpen(): Promise<void> {
    this.containerEl.tabIndex = -1
    this.registerDomEvent(this.containerEl, 'keydown', event => {
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable]')) return
      if (event.key === 'ArrowLeft') this.cycle(-1)
      if (event.key === 'ArrowRight') this.cycle(1)
    })
    void this.deps.chainNames().then(names => (this.chains = names))
    this.draw()
  }

  /** Points the panel at a run and, when a card was clicked, its proposal. */
  async point(runId: string, proposal?: string): Promise<void> {
    const sameRun = runId === this.runId
    this.runId = runId
    this.selected = proposal
    if (proposal) {
      this.to = proposal
      this.folds.delete(`0:card:${proposal}`)
    }
    if (!this.holds.has(runId)) {
      const note = await this.deps.loadNote(runId)
      this.missing = note === undefined
      if (note !== undefined) this.holds.set(runId, this.newHold(note))
    }
    this.draw()
    if (!sameRun || proposal) this.revealSelected()
  }

  private newHold(note: string): PrototypeHold {
    return new PrototypeHold(note, () => this.draw(), runId => this.deps.fetchPitch(runId), this.calls)
  }

  private get hold(): PrototypeHold | undefined {
    return this.runId ? this.holds.get(this.runId) : undefined
  }

  private cycle(step: number): void {
    this.variant = (this.variant + step + VARIANTS.length) % VARIANTS.length
    this.draw()
  }

  // ── drawing ────────────────────────────────────────────────────────────────

  private draw(): void {
    const root = this.contentEl
    const scroll = root.querySelector('.crp-body')?.scrollTop ?? 0
    root.empty()
    root.addClass('crp')
    this.switcher(root)
    this.header(root)
    const body = root.createDiv({ cls: 'crp-body' })
    const hold = this.hold
    if (!this.runId) {
      body.createDiv({ cls: 'crp-empty', text: 'Click a card, or a run’s ✎ Direct, on the drawing.' })
    } else if (!hold) {
      this.noHold(body)
    } else {
      const reading = hold.read()
      if (this.variant === 0) this.runSheet(body, hold, reading)
      if (this.variant === 1) this.proposalFocus(body, hold, reading)
      if (this.variant === 2) this.conversation(body, hold, reading)
    }
    if (hold && this.drawer) this.drawerView(root, hold)
    body.scrollTop = scroll
    if (this.focusKey) root.querySelector<HTMLElement>(`[data-key="${CSS.escape(this.focusKey)}"]`)?.focus()
  }

  private header(root: HTMLElement): void {
    const head = root.createDiv({ cls: 'crp-header' })
    const hold = this.hold?.read()
    const titleRow = head.createDiv({ cls: 'crp-title-row' })
    titleRow.createDiv({ cls: 'crp-title', text: hold ? `Directing · run ${hold.runId}` : 'Directing' })
    if (this.hold && this.runId) {
      const runId = this.runId
      const more = this.button(titleRow, '⋯', () => {}, 'crp-more')
      more.setAttribute('aria-label', 'More')
      more.onclick = event => this.moreMenu(runId).showAtMouseEvent(event)
    }
    if (hold) head.createDiv({ cls: 'crp-sub', text: `${hold.chainName} · prototype: nothing is saved, replies are canned` })
  }

  private moreMenu(runId: string): Menu {
    const drawerItem = (which: 'note' | 'calls', title: string, icon: string) => (item: MenuItem) =>
      item.setTitle(title).setIcon(icon).setChecked(this.drawer === which).onClick(() => this.toggleDrawer(which))
    return new Menu()
      .addItem(item =>
        item.setTitle('Open the hold note in a tab').setIcon('file-text').onClick(() => {
          this.openCount++
          this.deps.openNote(runId)
        }),
      )
      .addItem(drawerItem('note', 'Preview the hold note with my changes', 'eye'))
      .addSeparator()
      .addItem(drawerItem('calls', 'Which buttons I’ve used (prototype)', 'bar-chart'))
      .addItem(item =>
        item.setTitle('Discard my changes').setIcon('rotate-ccw').onClick(() => {
          this.holds.delete(runId)
          void this.point(runId, this.selected)
        }),
      )
  }

  private toggleDrawer(which: 'note' | 'calls'): void {
    this.drawer = this.drawer === which ? undefined : which
    this.draw()
  }

  private drawerView(root: HTMLElement, hold: PrototypeHold): void {
    const drawer = root.createDiv({ cls: 'crp-drawer' })
    const bar = drawer.createDiv({ cls: 'crp-drawer-bar' })
    bar.createSpan({ text: this.drawer === 'note' ? 'The hold note, with your changes' : 'Buttons you’ve used this session' })
    this.button(bar, '✕', () => this.toggleDrawer(this.drawer as 'note' | 'calls'), 'crp-quiet')
    drawer.createEl('pre', { text: this.drawer === 'note' ? hold.note : this.callTally() })
  }

  /** How often each hold action was used this session, then every call in order. */
  private callTally(): string {
    if (this.calls.length === 0) return '(no calls yet)'
    const counts = new Map<string, number>()
    for (const call of this.calls) counts.set(call.split('(')[0], (counts.get(call.split('(')[0]) ?? 0) + 1)
    const tally = [...counts].sort((a, b) => b[1] - a[1]).map(([action, count]) => `${count} × ${action}`)
    return [...tally, `${this.openCount} × open hold note`, '', ...this.calls].join('\n')
  }

  private noHold(body: HTMLElement): void {
    const runId = this.runId as string
    body.createDiv({ cls: 'crp-empty', text: this.missing ? `Run ${runId} has no hold note yet.` : 'Loading…' })
    this.action(body, 'direct', '✎ Direct this run (writes the hold note, for real)', async () => {
      await this.deps.writeHold(runId)
      this.holds.delete(runId)
      await this.point(runId, this.selected)
    }, 'mod-cta')
  }

  private switcher(root: HTMLElement): void {
    const bar = root.createDiv({ cls: 'crp-switcher' })
    this.button(bar, '‹', () => this.cycle(-1))
    bar.createSpan({ text: VARIANTS[this.variant] })
    this.button(bar, '›', () => this.cycle(1))
  }

  private revealSelected(): void {
    if (!this.selected) return
    this.contentEl.querySelector(`[data-proposal="${CSS.escape(this.selected)}"]`)?.scrollIntoView({ block: 'start' })
  }

  // ── A: the whole run, one sheet ────────────────────────────────────────────

  private runSheet(body: HTMLElement, hold: PrototypeHold, reading: HoldReading): void {
    this.verdict(body, reading, false)

    this.heading(body, 'Proposals')
    for (const proposal of reading.proposals) {
      const card = this.fold(body, `card:${proposal.name}`, '', proposal.name === this.selected, 'crp-card')
      card.dataset.proposal = proposal.name
      if (proposal.name === this.selected) card.addClass('is-selected')
      const summary = card.querySelector('summary') as HTMLElement
      summary.createSpan({ cls: 'crp-name', text: proposal.name })
      for (const verb of appliedVerbs(reading, proposal.name)) summary.createSpan({ cls: 'crp-chip', text: verb })
      this.verbs(card, hold, reading, proposal.name)
      this.proposalText(card, hold, proposal.name, proposal.text, true)
      const talk = this.fold(card, `talk:${proposal.name}`, `💬 Ask ${proposal.name}`, false)
      this.chatThread(talk, hold, proposal.name)
      const quest = this.fold(card, `quest:${proposal.name}`, '↪ Side quest', false)
      this.questBox(quest, hold, proposal.name)
    }

    this.heading(body, 'Ask the room')
    this.roomBox(body, hold)
    this.heading(body, 'Direction')
    this.directionSummary(body, hold, reading)
    this.heading(body, 'Canon')
    this.canon(body, hold, reading)
    this.heading(body, 'Resume')
    this.resume(body, hold)
  }

  // ── B: one proposal at a time ──────────────────────────────────────────────

  private proposalFocus(body: HTMLElement, hold: PrototypeHold, reading: HoldReading): void {
    const chips = body.createDiv({ cls: 'crp-tabs' })
    this.button(chips, 'Run', () => ((this.selected = undefined), this.draw()), this.selected ? '' : 'is-on')
    for (const proposal of reading.proposals) {
      this.button(chips, proposal.name, () => ((this.selected = proposal.name), this.draw()), proposal.name === this.selected ? 'is-on' : '')
    }

    const proposal = reading.proposals.find(p => p.name === this.selected)
    if (!proposal) {
      this.verdict(body, reading, true)
      this.heading(body, 'Direction so far')
      this.directionSummary(body, hold, reading)
      this.heading(body, 'Ask the room')
      this.roomBox(body, hold)
      this.heading(body, `Canon (${reading.canon.filter(c => c.ticked).length} of ${reading.canon.length} ticked)`)
      this.canon(body, hold, reading)
    } else {
      body.createDiv({ cls: 'crp-big', text: proposal.name }).dataset.proposal = proposal.name
      this.verbs(body, hold, reading, proposal.name, 'crp-verbs-big')
      this.proposalText(body, hold, proposal.name, proposal.text, false)
      this.heading(body, `Canon from ${proposal.name}`)
      this.canon(body, hold, reading, proposal.name)
      this.heading(body, `Chat with ${proposal.name}`)
      this.chatThread(body, hold, proposal.name)
      this.heading(body, 'Side quest')
      this.questBox(body, hold, proposal.name)
    }

    const tray = body.createDiv({ cls: 'crp-tray' })
    this.resume(tray, hold)
  }

  // ── C: everything as a conversation ────────────────────────────────────────

  private conversation(body: HTMLElement, hold: PrototypeHold, reading: HoldReading): void {
    const timeline = body.createDiv({ cls: 'crp-timeline' })
    this.verdict(timeline, reading, false)
    for (const name of [...this.editing]) {
      const proposal = reading.proposals.find(p => p.name === name)
      if (proposal) this.proposalText(timeline, hold, name, proposal.text, false)
    }
    for (const event of hold.events) this.bubble(timeline, event)
    for (const key of this.busy) timeline.createDiv({ cls: 'crp-bubble crp-waiting', text: `${key.replace(':', ' → ')} …` })

    const composer = body.createDiv({ cls: 'crp-composer' })
    const to = composer.createDiv({ cls: 'crp-row' })
    to.createSpan({ text: 'To' })
    const select = to.createEl('select')
    select.createEl('option', { text: 'the room', value: ROOM })
    for (const p of reading.proposals) select.createEl('option', { text: p.name, value: p.name })
    select.value = this.to
    select.onchange = () => ((this.to = select.value), (this.questing = false), this.draw())

    const name = this.to === ROOM ? undefined : this.to
    if (name) {
      const chips = composer.createDiv({ cls: 'crp-chips' })
      this.verbs(chips, hold, reading, name)
      this.button(chips, '✎ Edit', () => (this.editing.add(name), this.draw()))
      this.button(chips, '↪ Side quest', () => ((this.questing = !this.questing), this.draw()), this.questing ? 'is-on' : '')
      const last = this.chatEvents(hold, name).at(-1)
      if (last?.kind === 'chat' && last.reply && !last.revised) {
        this.action(chips, `revise:${name}`, 'Use last reply as revision', () => hold.revise(name))
      }
    }
    const canon = this.fold(composer, 'canon', `☐ Canon (${reading.canon.filter(c => c.ticked).length}/${reading.canon.length})`, false)
    this.canon(canon, hold, reading)

    if (name && this.questing) this.questBox(composer, hold, name)
    else if (name) this.input(composer, `chat:${name}`, `Message ${name}…`, text => hold.chat(name, text))
    else this.input(composer, 'room', 'Ask the room…', text => hold.askRoom(text))
    this.input(composer, 'change', 'CHANGE: …', async text => hold.change(text))
    this.resume(composer, hold, true)
  }

  private bubble(timeline: HTMLElement, event: HoldEvent): void {
    const bubble = timeline.createDiv({ cls: `crp-bubble crp-${event.kind}` })
    switch (event.kind) {
      case 'direction':
        bubble.setText(`You: ${event.line}`)
        break
      case 'edit':
        bubble.setText(`You edited ${event.name}`)
        break
      case 'rerun':
        bubble.setText(`Reran downstream of ${event.names.join(', ')} as run ${event.runId}`)
        break
      case 'canon':
        bubble.setText(`${event.ticked ? '☑' : '☐'} ${event.text}`)
        break
      case 'chat':
        bubble.createDiv({ cls: 'crp-me', text: `You → ${event.name}: ${event.message}` })
        if (event.reply) bubble.createDiv({ cls: 'crp-them', text: `${event.name}: ${event.reply}` })
        if (event.revised) bubble.createDiv({ cls: 'crp-sub', text: `revised → run ${event.revised}` })
        break
      case 'room':
        bubble.createDiv({ cls: 'crp-me', text: `You → the room: ${event.question}` })
        for (const a of event.answers ?? []) bubble.createDiv({ cls: 'crp-them', text: `${a.name}: ${a.answer}` })
        break
      case 'quest':
        bubble.createDiv({ cls: 'crp-me', text: `Side quest: ${event.name} through ${event.chainName}` })
        if (event.result) bubble.createDiv({ cls: 'crp-them', text: event.result })
        break
      case 'resume':
        bubble.createDiv({ cls: 'crp-me', text: '▶ Resume' })
        if (event.pitch) this.markdown(bubble.createDiv({ cls: 'crp-pitch' }), `**Greenlight pitch** · run ${event.runId}\n\n${event.pitch}`)
        break
    }
  }

  // ── widgets shared by the layouts ──────────────────────────────────────────

  private verdict(el: HTMLElement, reading: HoldReading, open: boolean): void {
    if (!reading.verdict) return
    const fold = this.fold(el, 'verdict', 'Verdict', open, 'crp-verdict')
    this.markdown(fold.createDiv(), reading.verdict)
  }

  /** A `<details>` whose open state survives the redraw every action causes. */
  private fold(el: HTMLElement, key: string, summary: string, open: boolean, cls = 'crp-fold'): HTMLDetailsElement {
    const fold = el.createEl('details', { cls })
    const stored = this.folds.get(`${this.variant}:${key}`)
    fold.open = stored ?? open
    fold.createEl('summary', { text: summary })
    fold.ontoggle = () => this.folds.set(`${this.variant}:${key}`, fold.open)
    return fold
  }

  private verbs(el: HTMLElement, hold: PrototypeHold, reading: HoldReading, name: string, cls = ''): void {
    const row = el.createDiv({ cls: `crp-verbs ${cls}` })
    const applied = new Set(appliedVerbs(reading, name))
    for (const verb of DIRECTION_VERBS) {
      if (verb === 'COMBINE') {
        const others = reading.proposals.map(p => p.name).filter(other => other !== name)
        const select = row.createEl('select', { cls: 'crp-combine' })
        select.createEl('option', { text: 'COMBINE…', value: '' })
        for (const other of others) select.createEl('option', { text: `+ ${other}`, value: other })
        select.onchange = () => select.value && hold.direct('COMBINE', name, select.value)
        continue
      }
      this.button(row, verb, () => hold.direct(verb as DirectionVerb, name), applied.has(verb) ? 'is-on' : '')
    }
  }

  private proposalText(el: HTMLElement, hold: PrototypeHold, name: string, text: string, folded: boolean): void {
    if (this.editing.has(name)) {
      const box = el.createDiv({ cls: 'crp-edit' })
      box.createDiv({ cls: 'crp-sub', text: `Editing ${name}` })
      const key = `edit:${name}`
      const area = box.createEl('textarea')
      area.dataset.key = key
      area.value = this.drafts.get(key) ?? text
      area.oninput = () => this.drafts.set(key, area.value)
      area.onfocus = () => (this.focusKey = key)
      area.onblur = () => this.focusKey === key && (this.focusKey = undefined)
      const row = box.createDiv({ cls: 'crp-row' })
      this.button(row, 'Save edit', () => {
        this.editing.delete(name)
        this.drafts.delete(key)
        hold.editProposal(name, area.value)
      }, 'mod-cta')
      this.button(row, 'Cancel', () => (this.editing.delete(name), this.drafts.delete(key), this.draw()))
      return
    }
    const wrap = folded ? this.fold(el, `read:${name}`, 'Read proposal', false) : el.createDiv()
    this.markdown(wrap.createDiv({ cls: 'crp-text' }), text)
    const row = el.createDiv({ cls: 'crp-row' })
    this.button(row, '✎ Edit', () => (this.editing.add(name), this.draw()))
    const edits = hold.pendingEdits()
    if (edits.length > 0) this.action(row, 'rerun', `⟳ Rerun downstream (${edits.join(', ')})`, () => hold.rerunDownstream(), 'mod-cta')
  }

  private chatEvents(hold: PrototypeHold, name: string): HoldEvent[] {
    return hold.events.filter(event => event.kind === 'chat' && event.name === name)
  }

  private chatThread(el: HTMLElement, hold: PrototypeHold, name: string): void {
    const thread = el.createDiv({ cls: 'crp-thread' })
    const turns = this.chatEvents(hold, name)
    for (const turn of turns) this.bubble(thread, turn)
    if (this.busy.has(`chat:${name}`)) thread.createDiv({ cls: 'crp-bubble crp-waiting', text: `${name} is replying…` })
    const last = turns.at(-1)
    if (last?.kind === 'chat' && last.reply && !last.revised) {
      this.action(thread, `revise:${name}`, 'Use this reply as the revision & rerun', () => hold.revise(name))
    }
    this.input(thread, `chat:${name}`, `Ask ${name}…`, text => hold.chat(name, text))
  }

  private roomBox(el: HTMLElement, hold: PrototypeHold): void {
    for (const event of hold.events.filter(e => e.kind === 'room')) this.bubble(el, event)
    if (this.busy.has('room')) el.createDiv({ cls: 'crp-bubble crp-waiting', text: 'The room is answering…' })
    this.input(el, 'room', 'Ask every proposer…', text => hold.askRoom(text))
  }

  private questBox(el: HTMLElement, hold: PrototypeHold, name: string): void {
    for (const event of hold.events.filter(e => e.kind === 'quest' && e.name === name)) this.bubble(el, event)
    const key = `quest:${name}`
    if (this.busy.has(key)) el.createDiv({ cls: 'crp-bubble crp-waiting', text: 'Side quest running…' })
    const list = el.createEl('datalist')
    list.id = `crp-chains-${this.variant}-${name}`
    for (const chain of this.chains) list.createEl('option', { value: chain })
    this.input(el, key, 'Chain to send it through…', chain => hold.sideQuest(name, chain))
    el.querySelector<HTMLInputElement>(`[data-key="${CSS.escape(key)}"]`)?.setAttribute('list', list.id)
  }

  private directionSummary(el: HTMLElement, hold: PrototypeHold, reading: HoldReading): void {
    const list = el.createEl('ul', { cls: 'crp-directions' })
    for (const line of reading.directions) list.createEl('li', { text: line })
    if (reading.directions.length === 0) list.createEl('li', { cls: 'crp-sub', text: 'Nothing directed yet' })
    this.input(el, 'change', 'CHANGE: describe a change…', async text => hold.change(text))
  }

  private canon(el: HTMLElement, hold: PrototypeHold, reading: HoldReading, only?: string): void {
    let group = ''
    for (const line of reading.canon.filter(c => !only || c.name === only)) {
      if (!only && line.name !== group) el.createDiv({ cls: 'crp-sub', text: (group = line.name) })
      const label = el.createEl('label', { cls: 'crp-canon' })
      const box = label.createEl('input', { type: 'checkbox' })
      box.checked = line.ticked
      box.onchange = () => hold.tickCanon(line.text, box.checked)
      label.createSpan({ text: line.line })
    }
  }

  private resume(el: HTMLElement, hold: PrototypeHold, compact = false): void {
    const ticked = hold.read().canon.filter(c => c.ticked).length
    this.action(el, 'resume', `▶ Resume${ticked ? ` · ${ticked} canon` : ''}`, () => hold.resume(), 'mod-cta')
    if (this.busy.has('resume')) el.createDiv({ cls: 'crp-sub', text: 'develop-direction is running…' })
    const last = [...hold.events].reverse().find(e => e.kind === 'resume' && e.pitch)
    if (!compact && last?.kind === 'resume' && last.pitch) {
      this.markdown(el.createDiv({ cls: 'crp-pitch' }), `**Greenlight pitch** · run ${last.runId}\n\n${last.pitch}`)
    }
  }

  private heading(el: HTMLElement, text: string): void {
    el.createDiv({ cls: 'crp-heading', text })
  }

  private input(el: HTMLElement, key: string, placeholder: string, submit: (text: string) => Promise<unknown>): void {
    const row = el.createDiv({ cls: 'crp-row crp-input' })
    const input = row.createEl('input', { type: 'text', placeholder })
    input.dataset.key = key
    input.value = this.drafts.get(key) ?? ''
    input.disabled = this.busy.has(key)
    input.oninput = () => this.drafts.set(key, input.value)
    input.onfocus = () => (this.focusKey = key)
    input.onblur = () => this.focusKey === key && (this.focusKey = undefined)
    const send = (): void => {
      const text = input.value.trim()
      if (!text || this.busy.has(key)) return
      this.drafts.delete(key)
      void this.run(key, () => submit(text))
    }
    input.onkeydown = event => event.key === 'Enter' && send()
    this.button(row, 'Send', send)
  }

  private action(el: HTMLElement, key: string, text: string, act: () => Promise<unknown>, cls = ''): void {
    const button = this.button(el, text, () => void this.run(key, act), cls)
    button.disabled = this.busy.has(key)
  }

  private async run(key: string, act: () => Promise<unknown>): Promise<void> {
    this.busy.add(key)
    this.draw()
    try {
      await act()
    } finally {
      this.busy.delete(key)
      this.draw()
    }
  }

  private button(el: HTMLElement, text: string, onClick: () => unknown, cls = ''): HTMLButtonElement {
    const button = el.createEl('button', { text, cls })
    button.onclick = event => {
      event.preventDefault()
      onClick()
    }
    return button
  }

  private markdown(el: HTMLElement, text: string): void {
    void MarkdownRenderer.render(this.app, text, el, '', this)
  }
}

/** The verbs already directed at a proposal, by the Direction lines that name it. */
function appliedVerbs(reading: HoldReading, name: string): string[] {
  return reading.directions
    .map(line => /^([A-Z]+): (.+)$/.exec(line))
    .filter((m): m is RegExpExecArray => !!m && m[2].split(' + ').includes(name))
    .map(m => m[1])
}
