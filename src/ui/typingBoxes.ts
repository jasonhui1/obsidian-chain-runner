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
  /** Suggestions to pick from, which make the box one line; anything typed still sends. */
  choices?: string[]
}

/** Numbers each suggestion list, since a box finds its list by a document-wide id. */
let choiceLists = 0

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
    const input = box.choices === undefined ? this.textarea(row) : this.chooser(row, box.choices)
    input.placeholder = box.placeholder
    input.dataset.box = box.key
    input.value = this.drafts.get(box.key) ?? ''
    const button = row.appendChild(doc.createElement('button'))
    button.className = 'mod-cta'
    button.textContent = box.label
    button.disabled = this.sending.has(box.key)

    // Widened: the input-or-textarea union loses addEventListener's typed events.
    const field: HTMLElement = input
    field.addEventListener('input', () => void this.drafts.set(box.key, input.value))
    // The hold keeps each message on one line, so Enter always sends.
    field.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return
      event.preventDefault()
      void this.send(box)
    })
    button.addEventListener('click', () => void this.send(box))
  }

  /** Call before a redraw empties `root`; what it returns puts the reader back in the box they were typing in. */
  keepTyping(root: HTMLElement): () => void {
    const active = root.ownerDocument.activeElement as TypedInto | null
    const key = active?.dataset?.box
    if (!active || key === undefined || !root.contains(active)) return () => {}
    const { selectionStart, selectionEnd } = active
    return () => {
      const input = Array.from(root.querySelectorAll<TypedInto>('[data-box]')).find(box => box.dataset.box === key)
      input?.focus()
      input?.setSelectionRange(selectionStart, selectionEnd)
    }
  }

  private textarea(row: HTMLElement): HTMLTextAreaElement {
    const input = row.appendChild(row.ownerDocument.createElement('textarea'))
    input.rows = 2
    return input
  }

  private chooser(row: HTMLElement, choices: string[]): HTMLInputElement {
    const doc = row.ownerDocument
    const input = row.appendChild(doc.createElement('input'))
    input.type = 'text'
    const list = row.appendChild(doc.createElement('datalist'))
    list.id = `chain-runner-directing-choices-${++choiceLists}`
    for (const choice of choices) list.appendChild(doc.createElement('option')).value = choice
    input.setAttribute('list', list.id)
    return input
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

type TypedInto = HTMLInputElement | HTMLTextAreaElement
