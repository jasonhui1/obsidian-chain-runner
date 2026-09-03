import { Component, ItemView, MarkdownRenderer, type IconName, type WorkspaceLeaf } from 'obsidian'
import { arrangeRun, type Arrangement, type RoundEntry } from './arrangement'
import { noticeFor } from './panelCopy'
import { createThrottle } from './throttle'
import type { RunPanel } from '../run/panels'
import { seedLine, type RunResult, type RunStatus } from '../run/session'

export const RESULT_VIEW_TYPE = 'chain-runner-result'

/** What a reader can do with one panel. Both write to the vault, so neither is the view's. */
export interface PanelActions {
  saveAsNote: (panel: RunPanel, run: RunResult) => void
  sendToDrawing: (panel: RunPanel, run: RunResult) => void
}

const STATUS_LABEL: Record<RunStatus, string> = {
  running: 'running',
  done: 'done',
  failed: 'failed',
}

/**
 * Where the quick path reads: one panel per declared output, streaming as the
 * run happens. The view decides nothing — what the panels are comes from
 * `src/run/` and where they land from `./arrangement`. Only markdown, redraw
 * rate and clicks are here.
 */
export class RunResultView extends ItemView {
  private result: RunResult | undefined
  /** The note the run was seeded from; markdown links resolve relative to it. */
  private sourcePath = ''
  private readonly throttle = createThrottle()
  /**
   * Owns the render children of the draw on screen. `MarkdownRenderer.render`
   * registers a child on the component it is handed, so each draw gets its own
   * host and the previous one is unloaded rather than accumulating.
   */
  private renderHost: Component | undefined
  /** The round clicked in a sidebar layout; unset means the detail follows the run. */
  private pickedRound: number | undefined

  constructor(
    leaf: WorkspaceLeaf,
    /** What the two panel actions do. They write to the vault; the view does not. */
    private readonly actions?: PanelActions,
  ) {
    super(leaf)
  }

  override getViewType(): string {
    return RESULT_VIEW_TYPE
  }

  override getDisplayText(): string {
    return this.result ? `⛓ ${this.result.chainName}` : 'Chain run'
  }

  override getIcon(): IconName {
    return 'link'
  }

  override async onOpen(): Promise<void> {
    this.draw()
  }

  override async onClose(): Promise<void> {
    this.throttle.cancel()
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
    const { contentEl } = this
    if (this.renderHost) this.removeChild(this.renderHost)
    this.renderHost = this.addChild(new Component())
    contentEl.empty()
    contentEl.addClass('chain-runner-result')

    if (!this.result) {
      contentEl.createDiv({
        cls: 'chain-runner-empty',
        text: 'Run a chain on a note — the result reads here.',
      })
      return
    }

    this.drawHeader(contentEl, this.result)
    if (this.result.layout.panels.length === 0) {
      contentEl.createDiv({ cls: 'chain-runner-empty', text: 'Nothing has run yet.' })
      return
    }
    this.drawArrangement(contentEl, arrangeRun(this.result.layout, this.pickedRound), this.result.status)
  }

  /** The arrangement as elements; `arrangeRun` has already decided what goes where. */
  private drawArrangement(parent: HTMLElement, arrangement: Arrangement, status: RunStatus): void {
    if (arrangement.kind === 'columns') {
      const columns = parent.createDiv({ cls: 'chain-runner-panels chain-runner-panels--columns' })
      for (const column of arrangement.columns) {
        const el = columns.createDiv({ cls: 'chain-runner-column' })
        if (column.converging) el.addClass('chain-runner-column--wide')
        this.drawPanel(el, column.panel, status)
      }
      return
    }

    if (arrangement.kind === 'sidebar') {
      const split = parent.createDiv({ cls: 'chain-runner-panels chain-runner-panels--sidebar' })
      const list = split.createDiv({ cls: 'chain-runner-rounds' })
      for (const entry of arrangement.rounds) this.drawRound(list, entry)
      const detail = split.createDiv({ cls: 'chain-runner-detail' })
      if (arrangement.detail) this.drawPanel(detail, arrangement.detail, status)
      return
    }

    const panels = parent.createDiv({ cls: 'chain-runner-panels' })
    for (const panel of arrangement.panels) this.drawPanel(panels, panel, status)
  }

  /** One row of the round list: which round it is, how much it holds, and how it went. */
  private drawRound(parent: HTMLElement, entry: RoundEntry): void {
    const { panel } = entry
    const el = parent.createDiv({ cls: `chain-runner-round chain-runner-round--${panel.state}` })
    if (entry.selected) el.addClass('chain-runner-round--selected')
    // Rounds of a loop share a name, so the iteration is what tells rows apart.
    // 0-based on the wire, 1-based to read.
    if (entry.round !== undefined) {
      el.createSpan({ cls: 'chain-runner-round-number', text: String(entry.round + 1) })
    }
    el.createSpan({ cls: 'chain-runner-round-name', text: panel.name })
    this.drawLines(el, 'chain-runner-round-lines', panel)
    // Redraw at once, not through the throttle, so the click feels like a click.
    el.onclick = (): void => {
      this.pickedRound = entry.index
      this.throttle.cancel()
      this.draw()
    }
  }

  private drawHeader(parent: HTMLElement, result: RunResult): void {
    const header = parent.createDiv({ cls: 'chain-runner-run-header' })

    const title = header.createDiv({ cls: 'chain-runner-run-title' })
    title.createSpan({ cls: 'chain-runner-run-name', text: result.chainName })
    title.createSpan({
      cls: `chain-runner-run-status chain-runner-run-status--${result.status}`,
      text: STATUS_LABEL[result.status],
    })

    if (result.moment) header.createDiv({ cls: 'chain-runner-run-moment', text: result.moment })

    const meta = header.createDiv({ cls: 'chain-runner-run-meta' })
    meta.createSpan({ text: seedLine(result.seed) })
    if (result.parameter) meta.createSpan({ text: `${result.parameter.name}: ${result.parameter.value}` })
    if (result.runId) meta.createSpan({ text: result.runId })

    if (result.error) header.createDiv({ cls: 'chain-runner-run-error', text: result.error })

    // A chain that declared no layout is not a broken one; say which is being shown.
    if (result.layout.kind === 'undeclared' && result.layout.panels.length > 0) {
      header.createDiv({
        cls: 'chain-runner-run-note',
        text: 'This chain declares no result view — showing the run trace.',
      })
    }
  }

  /** How much a panel holds, in the one wording both the panel head and a round row use. */
  private drawLines(parent: HTMLElement, cls: string, panel: RunPanel): void {
    parent.createSpan({ cls, text: panel.lines ? `${panel.lines} ln` : '—' })
  }

  /**
   * The two things a reader can do with a panel worth keeping. Offered only on a
   * filled panel of a run with an id, since an output note is stamped with it.
   */
  private drawActions(parent: HTMLElement, panel: RunPanel): void {
    const run = this.result
    if (!this.actions || !run?.runId || panel.state !== 'filled') return
    const actions = parent.createDiv({ cls: 'chain-runner-panel-actions' })
    this.drawAction(actions, 'Save as note', () => this.actions?.saveAsNote(panel, run))
    this.drawAction(actions, 'Send to drawing', () => this.actions?.sendToDrawing(panel, run))
  }

  private drawAction(parent: HTMLElement, label: string, onClick: () => void): void {
    const el = parent.createEl('button', { cls: 'chain-runner-panel-action', text: label })
    el.onclick = (event): void => {
      // A round row above the panel is clickable; this click is not for it.
      event.stopPropagation()
      onClick()
    }
  }

  private drawPanel(parent: HTMLElement, panel: RunPanel, status: RunStatus): void {
    const el = parent.createDiv({ cls: `chain-runner-panel chain-runner-panel--${panel.state}` })
    if (panel.emphasis) el.addClass(`chain-runner-panel--${panel.emphasis}`)

    const head = el.createDiv({ cls: 'chain-runner-panel-head' })
    head.createSpan({ cls: 'chain-runner-panel-name', text: panel.name })
    this.drawLines(head, 'chain-runner-panel-lines', panel)
    this.drawActions(head, panel)

    const notice = noticeFor(panel, status)
    if (notice) {
      el.createDiv({ cls: `chain-runner-panel-notice chain-runner-panel-notice--${notice.tone}`, text: notice.text })
    }

    const text = panel.state === 'filled' ? panel.text : (panel.streaming ?? '')
    if (text === '') return
    const body = el.createDiv({ cls: 'chain-runner-panel-body' })
    // Each draw builds its own body, so a late render writes into an element
    // already off the page rather than over the new one.
    void MarkdownRenderer.render(this.app, text, body, this.sourcePath, this.renderHost ?? this)
  }
}
