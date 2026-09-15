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
  /** Which `show` is current, so a slow read for an earlier run draws nothing. */
  private shown = 0
  private board: DirectingBoard | undefined

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
    this.drawing().open({ kind: 'idle' })
  }

  override async onClose(): Promise<void> {
    this.stopListening?.()
    this.stopListening = this.runId = undefined
    this.board?.draw({ kind: 'idle' })
  }

  /** Shows a run's hold, on a proposal's tab when one is named. */
  async show(runId: string, proposal?: string): Promise<void> {
    const shown = ++this.shown
    if (runId !== this.runId) {
      this.stopListening?.()
      this.runId = runId
      this.stopListening = this.deps.holds.onChange(runId, () => void this.refresh())
    }
    const state = await this.read(runId)
    if (shown === this.shown) this.drawing().open(state, proposal)
  }

  private async refresh(): Promise<void> {
    const runId = this.runId
    if (!runId) return
    const shown = this.shown
    const state = await this.read(runId)
    if (shown === this.shown) this.drawing().draw(state)
  }

  private async read(runId: string): Promise<DirectingState> {
    const hold = await this.deps.holds.read(runId)
    return hold ? { kind: 'hold', hold } : { kind: 'missing', runId }
  }

  private drawing(): DirectingBoard {
    return (this.board ??= new DirectingBoard(this.contentEl, {
      renderMarkdown: (text, into) => {
        const host = this.addChild(new Component())
        void MarkdownRenderer.render(this.app, text, into, '', host)
        return () => this.removeChild(host)
      },
      direct: (verb, proposal, other) => {
        if (this.runId) void this.deps.holds.direct(this.runId, verb, proposal, other)
      },
      tickCanon: (id, ticked) => {
        if (this.runId) void this.deps.holds.tickCanon(this.runId, id, ticked)
      },
      writeHold: () => {
        if (this.runId) void this.deps.writeHold(this.runId)
      },
      openMenu: event => {
        const runId = this.runId
        if (!runId) return
        new Menu()
          .addItem(item => item.setTitle('Open the hold note in a tab').setIcon('file-text').onClick(() => this.deps.openHoldNote(runId)))
          .showAtMouseEvent(event)
      },
    }))
  }
}
