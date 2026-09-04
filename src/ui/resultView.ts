import { Component, ItemView, MarkdownRenderer, type IconName, type WorkspaceLeaf } from 'obsidian'
import type { EngineReading } from './emptyState'
import { ResultBoard, type PanelActions } from './resultBoard'
import { createThrottle } from './throttle'
import type { RunResult } from '../run/session'

export const RESULT_VIEW_TYPE = 'chain-runner-result'

export type { PanelActions }

/**
 * Where the quick path reads: one panel per declared output, streaming as the
 * run happens. The view decides nothing — what the panels are comes from
 * `src/run/`, where they land from `./arrangement`, and the elements they get
 * from `./resultBoard`. Only Obsidian's markdown, redraw rate and the open
 * round are here.
 */
export class RunResultView extends ItemView {
  private result: RunResult | undefined
  /** The note the run was seeded from; markdown links resolve relative to it. */
  private sourcePath = ''
  private readonly throttle = createThrottle()
  /** The round clicked in a sidebar layout; unset means the detail follows the run. */
  private pickedRound: number | undefined
  private board: ResultBoard | undefined

  constructor(
    leaf: WorkspaceLeaf,
    /** Read on every draw, so the empty state moves with the engine. */
    private readonly engine: () => EngineReading,
    /** What the panel actions do. They write to the vault; the view does not. */
    private readonly actions?: PanelActions,
  ) {
    super(leaf)
  }

  override getViewType(): string {
    return RESULT_VIEW_TYPE
  }

  override getDisplayText(): string {
    return this.result?.chainName ?? 'Chain run'
  }

  override getIcon(): IconName {
    return 'link'
  }

  override async onOpen(): Promise<void> {
    this.draw()
  }

  override async onClose(): Promise<void> {
    this.throttle.cancel()
    this.board?.release()
  }

  /** Redraws for the engine coming or going, which only the no-run state reads. */
  refresh(): void {
    if (!this.result) this.draw()
  }

  /**
   * Shows a run, throttled while it streams. A settled one redraws at once and
   * drops the held frame, so the last thing seen is the finished run.
   */
  show(result: RunResult, sourcePath: string): void {
    // A running run with no panels is a launch's first draw, including one that
    // superseded a run still going — where a status edge would miss it.
    if (result.status === 'running' && result.layout.panels.length === 0) this.pickedRound = undefined
    this.result = result
    this.sourcePath = sourcePath
    if (result.status === 'running') {
      this.throttle.run(() => this.draw())
      return
    }
    this.throttle.cancel()
    this.draw()
  }

  private draw(): void {
    this.drawing().draw({ result: this.result, pickedRound: this.pickedRound })
  }

  /**
   * The board, made on the first draw. `MarkdownRenderer.render` registers a
   * child on the component it is handed, so each panel's render gets its own and
   * releasing the panel unloads it.
   */
  private drawing(): ResultBoard {
    return (this.board ??= new ResultBoard(this.contentEl, {
      engine: this.engine,
      actions: this.actions,
      renderMarkdown: (text, into) => {
        const host = this.addChild(new Component())
        void MarkdownRenderer.render(this.app, text, into, this.sourcePath, host)
        return () => this.removeChild(host)
      },
      onPickRound: index => {
        this.pickedRound = index
        // Redraw at once, not through the throttle, so the click feels like a click.
        this.throttle.cancel()
        this.draw()
      },
    }))
  }
}
