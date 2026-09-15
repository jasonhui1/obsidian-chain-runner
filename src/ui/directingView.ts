import { Component, ItemView, MarkdownRenderer, Menu, type IconName, type WorkspaceLeaf } from 'obsidian'
import { DirectingBoard, type DirectingState } from './directingBoard'
import type { HoldActions } from './holdActions'

export const DIRECTING_VIEW_TYPE = 'chain-runner-directing'

export interface DirectingViewDeps {
  holds: HoldActions
  /** Writes the hold for a run that has none, then shows it here. */
  writeHold: (runId: string) => Promise<void>
  openHoldNote: (runId: string) => void
}

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
    this.made?.draw({ kind: 'idle' })
  }

  /** Shows a run's hold, on a proposal's tab when one is named. */
  async show(runId: string, proposal?: string): Promise<void> {
    const read = ++this.latestRead
    if (runId !== this.runId) {
      this.stopListening?.()
      this.runId = runId
      this.stopListening = this.deps.holds.onChange(runId, () => void this.refresh())
    }
    const state = await this.read(runId)
    if (read === this.latestRead) this.board().open(state, proposal)
  }

  private async refresh(): Promise<void> {
    const runId = this.runId
    if (!runId) return
    const read = this.latestRead
    const state = await this.read(runId)
    if (read === this.latestRead) this.board().draw(state)
  }

  private async read(runId: string): Promise<DirectingState> {
    const hold = await this.deps.holds.read(runId)
    return hold ? { kind: 'hold', hold } : { kind: 'missing', runId }
  }

  private board(): DirectingBoard {
    return (this.made ??= new DirectingBoard(this.contentEl, {
      renderMarkdown: (text, into) => {
        const host = this.addChild(new Component())
        void MarkdownRenderer.render(this.app, text, into, '', host)
        return () => this.removeChild(host)
      },
      direct: (verb, proposal, other) => this.onRun(runId => this.deps.holds.direct(runId, verb, proposal, other)),
      tickCanon: (id, ticked) => this.onRun(runId => this.deps.holds.tickCanon(runId, id, ticked)),
      writeHold: () => this.onRun(runId => this.deps.writeHold(runId)),
      openMenu: event =>
        this.onRun(runId =>
          new Menu()
            .addItem(item => item.setTitle('Open the hold note in a tab').setIcon('file-text').onClick(() => this.deps.openHoldNote(runId)))
            .showAtMouseEvent(event),
        ),
    }))
  }

  /** A board action, on the run shown; nothing when none is. */
  private onRun(act: (runId: string) => unknown): void {
    if (this.runId) void act(this.runId)
  }
}
