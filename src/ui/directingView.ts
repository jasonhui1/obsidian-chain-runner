import { Component, ItemView, MarkdownRenderer, Menu, type IconName, type WorkspaceLeaf } from 'obsidian'
import { DirectingBoard, type DirectingBoardDeps } from './directingBoard'
import type { Hold } from './holds'
import { markdownEditor } from './proposalEditor'

export const DIRECTING_VIEW_TYPE = 'chain-runner-directing'

export type DirectingPanelDeps = Pick<DirectingBoardDeps, 'holds' | 'reruns' | 'chains' | 'runUrl'>

/** The directing panel's leaf in the right sidebar; what it shows is `./directingBoard`. */
export class DirectingView extends ItemView {
  private readonly board: DirectingBoard

  constructor(leaf: WorkspaceLeaf, deps: DirectingPanelDeps) {
    super(leaf)
    this.board = new DirectingBoard(this.contentEl, {
      ...deps,
      renderMarkdown: (text, into) => {
        const host = this.addChild(new Component())
        void MarkdownRenderer.render(this.app, text, into, '', host)
        return () => this.removeChild(host)
      },
      openEditor: (text, changed) => markdownEditor(this.contentEl.ownerDocument, text, changed),
      openMenu: (event, items) => {
        const menu = new Menu()
        for (const one of items) menu.addItem(item => item.setTitle(one.title).setIcon(one.icon).onClick(one.click))
        menu.showAtMouseEvent(event)
      },
      clock: {
        every: (ms, tick) => {
          const win = this.contentEl.win
          const id = win.setInterval(tick, ms)
          return () => win.clearInterval(id)
        },
      },
      watchOverflow: (frame, changed) => {
        const observer = new ResizeObserver(() => changed(frame.scrollHeight > frame.clientHeight + 1))
        observer.observe(frame)
        if (frame.firstElementChild) observer.observe(frame.firstElementChild)
        return () => observer.disconnect()
      },
    })
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

  override async onClose(): Promise<void> {
    this.board.close()
  }

  /** Shows the hold the hold module answered for `runId`, on a proposal's tab when one is named; none is its missing note. */
  show(runId: string, hold: Hold | undefined, proposal?: string, holdId?: string): void {
    this.board.show(runId, hold, proposal, holdId)
  }
}
