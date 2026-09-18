/**
 * The directing panel's typing boxes: Enter sends, a box empties while what it
 * sent waits and cannot send again, a failed send goes back in, and a box is
 * kept across draws, so what is typed, and where, is never put back. Plain DOM.
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
  private readonly rows = new WeakMap<HTMLElement, BoxParts>()

  constructor(private readonly redraw: () => void) {}

  /** What the box sent that has not been answered yet. */
  waiting(key: string): string | undefined {
    return this.sending.get(key)
  }

  /** Fills `row`, which the panel keeps across draws, with `box`: made once, then updated in place. */
  draw(row: HTMLElement, box: TypingBox): void {
    const parts = this.rows.get(row) ?? this.build(row, box)
    parts.box = box
    parts.input.placeholder = box.placeholder
    const draft = this.drafts.get(box.key) ?? ''
    if (parts.input.value !== draft) parts.input.value = draft
    parts.button.textContent = box.label
    parts.button.disabled = this.sending.has(box.key)
    if (parts.list && box.choices) choose(parts.list, box.choices)
  }

  private build(row: HTMLElement, box: TypingBox): BoxParts {
    const doc = row.ownerDocument
    row.className = 'chain-runner-directing-box'
    const input = box.choices === undefined ? this.textarea(row) : this.chooser(row)
    const button = row.appendChild(doc.createElement('button'))
    button.className = 'mod-cta'
    const parts: BoxParts = { box, input, button, list: row.querySelector('datalist') ?? undefined }
    this.rows.set(row, parts)

    // Widened: the input-or-textarea union loses addEventListener's typed events.
    const field: HTMLElement = input
    field.addEventListener('input', () => void this.drafts.set(parts.box.key, input.value))
    // The hold keeps each message on one line, so Enter always sends.
    field.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return
      event.preventDefault()
      void this.send(parts.box)
    })
    button.addEventListener('click', () => void this.send(parts.box))
    return parts
  }

  private textarea(row: HTMLElement): HTMLTextAreaElement {
    const input = row.appendChild(row.ownerDocument.createElement('textarea'))
    input.rows = 2
    return input
  }

  private chooser(row: HTMLElement): HTMLInputElement {
    const doc = row.ownerDocument
    const input = row.appendChild(doc.createElement('input'))
    input.type = 'text'
    const list = row.appendChild(doc.createElement('datalist'))
    list.id = `chain-runner-directing-choices-${++choiceLists}`
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

/** One box's elements; `box` is the last draw's, which the listeners read. */
interface BoxParts {
  box: TypingBox
  input: HTMLInputElement | HTMLTextAreaElement
  button: HTMLButtonElement
  list: HTMLDataListElement | undefined
}

/** Puts `choices` in the list, leaving it be when it already holds them. */
function choose(list: HTMLDataListElement, choices: string[]): void {
  if (Array.from(list.options, option => option.value).join('\n') === choices.join('\n')) return
  list.replaceChildren(...choices.map(choice => Object.assign(list.ownerDocument.createElement('option'), { value: choice })))
}
