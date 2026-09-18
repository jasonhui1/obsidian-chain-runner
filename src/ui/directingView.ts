import { Component, ItemView, MarkdownRenderer, Menu, type IconName, type WorkspaceLeaf } from 'obsidian'
import { DirectingBoard, type DirectingState } from './directingBoard'
import type { Hold, Holds } from './holds'
import { markdownEditor } from './proposalEditor'

export const DIRECTING_VIEW_TYPE = 'chain-runner-directing'

export interface DirectingViewDeps {
  holds: Holds
  /** The chains a side quest can go through; none while the engine cannot say. */
  chains: () => Promise<string[]>
  /** Where a run is shown on the engine, as it is set now (ADR-0004). */
  runUrl: (runId: string) => string | undefined
}

/**
 * The directing panel in the right sidebar: one run's hold, drawn from what the
 * hold module answers, and read again only when the note is edited by hand.
 * What it draws is `./directingBoard`.
 */
export class DirectingView extends ItemView {
  private runId: string | undefined
  private stopListening: (() => void) | undefined
  /** Counts draws, so a slow read overtaken by a later one draws nothing. */
  private latestRead = 0
  private made: DirectingBoard | undefined

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: DirectingViewDeps,
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
    const read = ++this.latestRead
    // On the new run at once, so an action on the old one landing meanwhile draws nothing.
    this.listen(runId)
    const hold = await this.deps.holds.read(runId)
    if (read !== this.latestRead) return
    this.listen(hold?.runId ?? runId)
    this.board().open(stateOf(hold, runId), proposal)
  }

  private listen(runId: string): void {
    if (runId === this.runId) return
    this.stopListening?.()
    this.runId = runId
    this.stopListening = this.deps.holds.onChange(runId, () => void this.refresh())
  }

  /** The note was edited, by any hand. */
  private async refresh(): Promise<void> {
    const runId = this.runId
    if (!runId) return
    const read = this.latestRead
    const hold = await this.deps.holds.read(runId)
    if (read === this.latestRead) this.board().draw(stateOf(hold, runId))
  }

  /** Whether an action on `from` wrote anything; what it answered is drawn, unless the panel moved on meanwhile. */
  private wrote(from: string, hold: Hold | undefined): boolean {
    if (!hold) return false
    if (from !== this.runId) return true
    ++this.latestRead
    this.listen(hold.runId)
    this.board().draw({ kind: 'hold', hold })
    return true
  }

  /** An action on the run shown, its answer drawn; whether it wrote anything. */
  private async act(action: (runId: string) => Promise<Hold | undefined>): Promise<boolean> {
    const runId = this.runId
    return runId !== undefined && this.wrote(runId, await action(runId))
  }

  private board(): DirectingBoard {
    const { holds } = this.deps
    return (this.made ??= new DirectingBoard(this.contentEl, {
      renderMarkdown: (text, into) => {
        const host = this.addChild(new Component())
        void MarkdownRenderer.render(this.app, text, into, '', host)
        return () => this.removeChild(host)
      },
      direct: (verb, proposal, other) => void this.act(runId => holds.direct(runId, verb, proposal, other)),
      undirect: (verb, proposal, other) => void this.act(runId => holds.undirect(runId, verb, proposal, other)),
      tickCanon: (id, ticked) => void this.act(runId => holds.tickCanon(runId, id, ticked)),
      tickCandidate: (nodeId, heading, ticked) => void this.act(runId => holds.pickCandidate(runId, nodeId, heading, ticked)),
      writeHold: () => void this.act(runId => holds.write(runId)),
      chat: (proposal, message) => this.act(runId => holds.chat(runId, proposal, message)),
      askRoom: question => this.act(runId => holds.askRoom(runId, question)),
      change: text => this.act(runId => holds.change(runId, text)),
      editProposal: (proposal, text) => this.act(runId => holds.editProposal(runId, proposal, text)),
      sideQuest: (proposal, chain) => this.act(runId => holds.sideQuest(runId, proposal, chain)),
      revise: async (turn, onProgress) => void (await this.act(async runId => (await holds.revise(runId, turn, onProgress))?.hold)),
      rerun: async onProgress => void (await this.act(async runId => (await holds.rerun(runId, onProgress))?.hold)),
      resume: async runId => {
        const resumed = await holds.resume(runId)
        this.wrote(runId, resumed?.hold)
        return resumed
      },
      chains: () => this.deps.chains(),
      runUrl: runId => this.deps.runUrl(runId),
      openEditor: (text, changed) => markdownEditor(this.contentEl.ownerDocument, text, changed),
      now: () => Date.now(),
      every: (ms, tick) => {
        const id = this.contentEl.win.setInterval(tick, ms)
        return () => this.contentEl.win.clearInterval(id)
      },
      openMenu: event => {
        const runId = this.runId
        if (!runId) return
        new Menu()
          .addItem(item => item.setTitle('Open the hold note in a tab').setIcon('file-text').onClick(() => void holds.open(runId)))
          .showAtMouseEvent(event)
      },
      watchOverflow: (frame, changed) => {
        const observer = new ResizeObserver(() => changed(frame.scrollHeight > frame.clientHeight + 1))
        observer.observe(frame)
        if (frame.firstElementChild) observer.observe(frame.firstElementChild)
        return () => observer.disconnect()
      },
    }))
  }
}

function stateOf(hold: Hold | undefined, runId: string): DirectingState {
  return hold ? { kind: 'hold', hold } : { kind: 'missing', runId }
}
