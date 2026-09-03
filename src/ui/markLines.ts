import { Modal, type App } from 'obsidian'
import { MarkSelection, type MarkRange } from '../run/keepMarks'

/**
 * The marking surface: every line of the text, marked by click or by keyboard.
 * The marks live here for as long as the modal is open and nowhere else — a
 * note is never written to say which of its lines someone liked.
 */
export class MarkLinesModal extends Modal {
  private readonly selection: MarkSelection
  private rows: HTMLElement[] = []
  private count: HTMLElement | undefined

  constructor(
    app: App,
    text: string,
    private readonly onDone: (marked: MarkRange[]) => void,
  ) {
    super(app)
    this.selection = new MarkSelection(text)
  }

  override onOpen(): void {
    this.titleEl.setText('Mark the lines to keep')
    this.modalEl.addClass('chain-runner-mark-modal')
    this.drawLines()
    this.drawFooter()
    this.registerKeys()
    this.refresh()
  }

  override onClose(): void {
    this.contentEl.empty()
  }

  private drawLines(): void {
    const list = this.contentEl.createDiv({ cls: 'chain-runner-mark-lines' })
    this.rows = this.selection.lines.map((line, index) => {
      const row = list.createDiv({ cls: 'chain-runner-mark-line' })
      // A blank line is still a line to mark, and needs a height to be clickable.
      row.createSpan({ cls: 'chain-runner-mark-text', text: line === '' ? '\u00a0' : line })
      row.onclick = (): void => {
        this.selection.toggle(index)
        this.refresh()
      }
      return row
    })
  }

  private drawFooter(): void {
    const footer = this.contentEl.createDiv({ cls: 'chain-runner-mark-footer' })
    this.count = footer.createSpan({ cls: 'chain-runner-mark-count' })
    footer.createSpan({
      cls: 'chain-runner-mark-hint',
      text: '↑ ↓ move · space marks · enter is done',
    })
    const done = footer.createEl('button', { cls: 'mod-cta', text: 'Done' })
    done.onclick = (): void => this.finish()
  }

  private registerKeys(): void {
    this.scope.register([], 'ArrowUp', () => this.step(-1))
    this.scope.register([], 'ArrowDown', () => this.step(1))
    this.scope.register([], ' ', () => {
      this.selection.toggleCurrent()
      this.refresh()
      return false
    })
    this.scope.register([], 'Enter', () => {
      this.finish()
      return false
    })
  }

  private step(delta: number): false {
    this.selection.move(delta)
    this.refresh()
    return false
  }

  private refresh(): void {
    this.rows.forEach((row, index) => {
      row.toggleClass('chain-runner-mark-line--marked', this.selection.isMarked(index))
      row.toggleClass('chain-runner-mark-line--current', index === this.selection.cursor)
    })
    this.rows[this.selection.cursor]?.scrollIntoView({ block: 'nearest' })
    const marked = this.selection.count
    this.count?.setText(marked === 0 ? 'nothing marked' : `${marked} ln marked`)
  }

  private finish(): void {
    const marked = this.selection.ranges()
    this.close()
    this.onDone(marked)
  }
}
