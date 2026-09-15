/**
 * The directing panel's typing boxes: Enter sends, a box empties while what it
 * sent waits and cannot send again, a failed send goes back in, and what is
 * typed survives a redraw. Plain DOM.
 */

export interface TypingBox {
  /** Unique on the panel; a box's draft and waiting message are kept under it. */
  key: string
  placeholder: string
  label: string
  /** Answers whether what was typed reached the hold. */
  send: (text: string) => Promise<boolean>
}

export class TypingBoxes {
  private readonly drafts = new Map<string, string>()
  private readonly sending = new Map<string, string>()

  constructor(private readonly redraw: () => void) {}

  /** What the box sent that has not been answered yet. */
  waiting(key: string): string | undefined {
    return this.sending.get(key)
  }

  draw(el: HTMLElement, box: TypingBox): void {
    const doc = el.ownerDocument
    const row = el.appendChild(doc.createElement('div'))
    row.className = 'chain-runner-directing-box'
    const input = row.appendChild(doc.createElement('textarea'))
    input.placeholder = box.placeholder
    input.rows = 2
    input.dataset.box = box.key
    input.value = this.drafts.get(box.key) ?? ''
    const button = row.appendChild(doc.createElement('button'))
    button.className = 'mod-cta'
    button.textContent = box.label
    button.disabled = this.sending.has(box.key)

    input.addEventListener('input', () => void this.drafts.set(box.key, input.value))
    // The hold keeps each message on one line, so Enter always sends.
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return
      event.preventDefault()
      void this.send(box)
    })
    button.addEventListener('click', () => void this.send(box))
  }

  /** Call before a redraw empties `root`; what it returns puts the reader back in the box they were typing in. */
  keepTyping(root: HTMLElement): () => void {
    const active = root.ownerDocument.activeElement
    if (active?.tagName !== 'TEXTAREA' || !root.contains(active)) return () => {}
    const { dataset, selectionStart, selectionEnd } = active as HTMLTextAreaElement
    return () => {
      const input = Array.from(root.querySelectorAll('textarea')).find(box => box.dataset.box === dataset.box)
      input?.focus()
      input?.setSelectionRange(selectionStart, selectionEnd)
    }
  }

  private async send(box: TypingBox): Promise<void> {
    const text = this.drafts.get(box.key)?.trim() ?? ''
    if (text === '' || this.sending.has(box.key)) return
    this.drafts.delete(box.key)
    this.sending.set(box.key, text)
    this.redraw()
    let sent = false
    try {
      sent = await box.send(text)
    } finally {
      this.sending.delete(box.key)
      if (!sent && !this.drafts.get(box.key)) this.drafts.set(box.key, text)
      this.redraw()
    }
  }
}
