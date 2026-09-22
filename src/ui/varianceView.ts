import { ItemView, type IconName, type WorkspaceLeaf } from 'obsidian'
import type { VarianceGroup } from '../engine/types'
import type { VarianceProgress } from '../run/varianceProgress'
import { VarianceBoard } from './varianceBoard'

export const VARIANCE_VIEW_TYPE = 'chain-runner-variance'

/** The quick runner's destination while the group completes and after it lands. */
export class VarianceView extends ItemView {
  private readonly board: VarianceBoard
  private title = 'Variance group'

  constructor(leaf: WorkspaceLeaf, openGroup: (groupId: string) => void) {
    super(leaf)
    this.board = new VarianceBoard(this.contentEl, { openGroup })
  }

  override getViewType(): string {
    return VARIANCE_VIEW_TYPE
  }

  override getDisplayText(): string {
    return this.title
  }

  override getIcon(): IconName {
    return 'git-compare'
  }

  showProgress(progress: VarianceProgress): void {
    this.title = `Running ${progress.expectedRunCount} times`
    this.board.showProgress(progress)
  }

  showGroup(group: VarianceGroup): void {
    this.title = `Variance · ${group.chainName}`
    this.board.showGroup(group)
  }

  showFailure(message: string): void {
    this.title = 'Variance group'
    this.board.showFailure(message)
  }
}
