import { KeyedChildren } from './keyed'
import { splitBlocks } from './streamBlocks'

/**
 * One panel's answer in the DOM. While a hop writes, the answer is rendered block
 * by block so a settled block is never touched again, and the panel renders whole
 * once the answer lands (ADR-0008).
 */
export class PanelBody {
  private readonly blocks: KeyedChildren
  /** What each block element holds, so a block that did not grow is not rendered again. */
  private readonly rendered = new Map<string, string>()
  private readonly releases = new Map<string, () => void>()

  constructor(
    private readonly el: HTMLElement,
    private readonly renderMarkdown: (text: string, into: HTMLElement) => () => void,
  ) {
    this.blocks = new KeyedChildren({
      make: () => {
        const block = el.ownerDocument.createElement('div')
        block.className = 'chain-runner-panel-block'
        return block
      },
      onRemove: key => this.drop(key),
    })
  }

  /** Draws an answer still being written: only its last block can still change. */
  stream(text: string): void {
    this.draw(splitBlocks(text))
  }

  /** Draws an answer that has landed, in the one pass that leaves nothing block-local. */
  settle(text: string): void {
    this.draw(text === '' ? [] : [text])
  }

  release(): void {
    this.blocks.clear()
  }

  private draw(pieces: string[]): void {
    pieces.forEach((piece, index) => {
      const key = String(index)
      const { el: block } = this.blocks.use(key, this.el)
      // Blank lines close a block without changing what it renders to.
      const text = piece.trimEnd()
      if (this.rendered.get(key) === text) return
      this.drop(key)
      block.replaceChildren()
      this.rendered.set(key, text)
      if (text !== '') this.releases.set(key, this.renderMarkdown(text, block))
    })
    this.blocks.end()
  }

  private drop(key: string): void {
    this.releases.get(key)?.()
    this.releases.delete(key)
    this.rendered.delete(key)
  }
}
