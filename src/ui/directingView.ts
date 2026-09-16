import { Component, ItemView, MarkdownRenderer, Menu, type IconName, type WorkspaceLeaf } from 'obsidian'
import { DirectingBoard, type DirectingState } from './directingBoard'
import type { HoldActions } from './holdActions'
import { markdownEditor } from './proposalEditor'

export const DIRECTING_VIEW_TYPE = 'chain-runner-directing'

/**
 * The directing panel in the right sidebar: one run's hold, read through the
 * hold actions and redrawn whenever it changes. What it draws is `./directingBoard`.
 */
export class DirectingView extends ItemView {
  private runId: string | undefined
  private stopListening: (() => void) | undefined
  /** Counts reads, so a slow one overtaken by a later `show` draws nothing. */
  private latestRead = 0
  private made: DirectingBoard | undefined

  constructor(
    leaf: WorkspaceLeaf,
    private readonly holds: HoldActions,
  ) {
    super(leaf)
  }

  override getViewType(): string {
    return DIRECTING_VIEW_TYPE
  }

  override getDisplayText(): string {
    return 'Directing'
  }

  override getIcon(): IconName {
    return 'clapperboard'
  }

  override async onOpen(): Promise<void> {
    this.board().open({ kind: 'idle' })
  }

  override async onClose(): Promise<void> {
    this.stopListening?.()
    this.stopListening = this.runId = undefined
    this.made?.close()
    this.made?.draw({ kind: 'idle' })
  }

  /** Shows a run's hold, on a proposal's tab when one is named; a hold rerun since is shown as it now is. */
  async show(runId: string, proposal?: string): Promise<void> {
    const state = await this.moveTo(await this.holds.currentRun(runId))
    if (state) this.board().open(state, proposal)
  }

  /** A rerun moves the hold to the run it landed on; the panel follows, on the tab it was on, unless it has moved on. */
  private async follow(from: string, landed: string | undefined): Promise<void> {
    if (!landed || from !== this.runId) return
    // Before the move, so no redraw of the new hold drops an open edit.
    this.board().moved(from, landed)
    const state = await this.moveTo(landed)
    if (state) this.board().draw(state)
  }

  /** Listens to `runId`'s hold, and reads it; `undefined` when a later move overtook this one. */
  private async moveTo(runId: string): Promise<DirectingState | undefined> {
    const read = ++this.latestRead
    if (runId !== this.runId) {
      this.stopListening?.()
      this.runId = runId
      this.stopListening = this.holds.onChange(runId, () => void this.refresh())
    }
    const state = await this.read(runId)
    return read === this.latestRead ? state : undefined
  }

  private async refresh(): Promise<void> {
    const runId = this.runId
    if (!runId) return
    const read = this.latestRead
    const state = await this.read(runId)
    if (read === this.latestRead) this.board().draw(state)
  }

  private async read(runId: string): Promise<DirectingState> {
    const hold = await this.holds.read(runId)
    return hold ? { kind: 'hold', hold } : { kind: 'missing', runId }
  }

  private board(): DirectingBoard {
    return (this.made ??= new DirectingBoard(this.contentEl, {
      renderMarkdown: (text, into) => {
        const host = this.addChild(new Component())
        void MarkdownRenderer.render(this.app, text, into, '', host)
        return () => this.removeChild(host)
      },
      direct: (verb, proposal, other) => this.onRun(runId => this.holds.direct(runId, verb, proposal, other)),
      undirect: (verb, proposal, other) => this.onRun(runId => this.holds.undirect(runId, verb, proposal, other)),
      tickCanon: (id, ticked) => this.onRun(runId => this.holds.tickCanon(runId, id, ticked)),
      writeHold: () => this.onRun(runId => this.holds.writeHold(runId)),
      chat: (proposal, message) => this.written(runId => this.holds.chat(runId, proposal, message)),
      askRoom: question => this.written(runId => this.holds.askRoom(runId, question)),
      change: text => this.written(runId => this.holds.change(runId, text)),
      editProposal: (proposal, text) => this.written(runId => this.holds.editProposal(runId, proposal, text)),
      revise: async (turn, onProgress) => {
        const runId = this.runId
        if (runId) await this.follow(runId, await this.holds.revise(runId, turn, onProgress))
      },
      resume: runId => this.holds.resume(runId),
      rerun: async onProgress => {
        const runId = this.runId
        if (runId) await this.follow(runId, await this.holds.rerun(runId, onProgress))
      },
      sideQuest: (proposal, chain) => this.written(runId => this.holds.sideQuest(runId, proposal, chain)),
      chains: () => this.holds.chains(),
      runUrl: runId => this.holds.runUrl(runId),
      openEditor: (text, changed) => markdownEditor(this.contentEl.ownerDocument, text, changed),
      now: () => Date.now(),
      every: (ms, tick) => {
        const id = this.contentEl.win.setInterval(tick, ms)
        return () => this.contentEl.win.clearInterval(id)
      },
      openMenu: event =>
        this.onRun(runId =>
          new Menu()
            .addItem(item => item.setTitle('Open the hold note in a tab').setIcon('file-text').onClick(() => void this.holds.openInTab(runId)))
            .showAtMouseEvent(event),
        ),
      watchOverflow: (frame, changed) => {
        const observer = new ResizeObserver(() => changed(frame.scrollHeight > frame.clientHeight + 1))
        observer.observe(frame)
        if (frame.firstElementChild) observer.observe(frame.firstElementChild)
        return () => observer.disconnect()
      },
    }))
  }

  /** A board action, on the run shown; nothing when none is. */
  private onRun(act: (runId: string) => unknown): void {
    if (this.runId) void act(this.runId)
  }

  /** A board action that writes the hold, redrawn from it before the board is told it landed. */
  private async written(act: (runId: string) => Promise<boolean>): Promise<boolean> {
    const runId = this.runId
    if (!runId) return false
    const done = await act(runId)
    if (done && runId === this.runId) await this.refresh()
    return done
  }
}
