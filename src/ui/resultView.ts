import { Component, ItemView, MarkdownRenderer, type IconName, type WorkspaceLeaf } from 'obsidian'
import { noticeFor } from './panelCopy'
import { createThrottle } from './throttle'
import type { RunPanel } from '../run/panels'
import type { RunResult, RunStatus } from '../run/session'

export const RESULT_VIEW_TYPE = 'chain-runner-result'

const STATUS_LABEL: Record<RunStatus, string> = {
  running: 'running',
  done: 'done',
  failed: 'failed',
}

/**
 * Where the quick path reads: one panel per declared output, in the shape the
 * chain asked for, streaming as the run happens.
 *
 * The view decides nothing about the run. It is handed a `RunResult` and draws
 * it; what the panels are, what state each is in and what a state says all come
 * from `src/run/`, where they are checkable without a vault. What lands here is
 * the two things only a view can do: markdown, and how often to redraw.
 */
export class RunResultView extends ItemView {
  private result: RunResult | undefined
  /** The note the run was seeded from; markdown links resolve relative to it. */
  private sourcePath = ''
  private readonly throttle = createThrottle()
  /**
   * Owns the render children of the draw on screen.
   *
   * `MarkdownRenderer.render` registers a child on the component it is handed,
   * and at ten draws a second a long run would leave hundreds of them attached
   * to the view until it closed — exactly the cost the throttle exists to avoid.
   * Each draw gets its own host, and the previous one is unloaded with the
   * elements it rendered into.
   */
  private renderHost: Component | undefined

  constructor(leaf: WorkspaceLeaf) {
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
   * Shows a run, throttled while it streams.
   *
   * A settled run redraws at once and drops whatever frame was held: the last
   * thing a reader sees must be the finished run, not a frame from just before
   * it landed.
   */
  show(result: RunResult, sourcePath: string): void {
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
    const panels = contentEl.createDiv({ cls: 'chain-runner-panels' })
    for (const panel of this.result.layout.panels) this.drawPanel(panels, panel, this.result.status)
    if (this.result.layout.panels.length === 0) {
      panels.createDiv({ cls: 'chain-runner-empty', text: 'Nothing has run yet.' })
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
    meta.createSpan({ text: `seed: ${result.seedSource}` })
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

  private drawPanel(parent: HTMLElement, panel: RunPanel, status: RunStatus): void {
    const el = parent.createDiv({ cls: `chain-runner-panel chain-runner-panel--${panel.state}` })
    if (panel.emphasis) el.addClass(`chain-runner-panel--${panel.emphasis}`)

    const head = el.createDiv({ cls: 'chain-runner-panel-head' })
    head.createSpan({ cls: 'chain-runner-panel-name', text: panel.name })
    head.createSpan({ cls: 'chain-runner-panel-lines', text: panel.lines ? `${panel.lines} ln` : '—' })

    const notice = noticeFor(panel, status)
    if (notice) {
      el.createDiv({ cls: `chain-runner-panel-notice chain-runner-panel-notice--${notice.tone}`, text: notice.text })
    }

    const text = panel.state === 'filled' ? panel.text : (panel.streaming ?? '')
    if (text === '') return
    const body = el.createDiv({ cls: 'chain-runner-panel-body' })
    // Each draw builds its own body, so a render that resolves after the next
    // draw writes into an element already off the page rather than over the new one.
    void MarkdownRenderer.render(this.app, text, body, this.sourcePath, this.renderHost ?? this)
  }
}
