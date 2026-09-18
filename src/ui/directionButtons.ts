import { FuzzySuggestModal, type App, type MarkdownPostProcessor } from 'obsidian'
import type { NoteStore } from './noteStore'
import { guardWrite } from './vaultWrite'
import { appendDirectionLine, directionLine, DIRECTION_VERBS, type DirectionVerb } from '../run/holdNote'

/**
 * The verb buttons next to each proposal in a hold note — a shortcut for
 * typing the same line by hand under Direction. What the line says is
 * `../run/holdNote.ts`; this is only the buttons.
 */

export const PROPOSAL_BUTTONS_CLASS = 'chain-runner-direction-buttons'
export const PROPOSAL_BUTTON_CLASS = 'chain-runner-direction-button'
const HOLD_TITLE = /^Hold: run \S+/

export interface DirectionButtonsDeps {
  /** For the COMBINE picker. */
  app: App
  store: NoteStore
  notify: (message: string) => void
}

/** The note a button's row is drawn in — carried as one value everywhere the row and its clicks need it. */
interface NoteContext {
  deps: DirectionButtonsDeps
  sourcePath: string
}

/**
 * Draws a button row under every proposal heading — deferred like the source-run
 * header, because a post-processor runs per section against an element not yet
 * in the document, and the note's other headings are what say this is a hold.
 */
export function createDirectionButtons(deps: DirectionButtonsDeps): MarkdownPostProcessor {
  return (el, ctx) => {
    setTimeout(() => {
      const container = el.closest('.markdown-rendered, .markdown-preview-view') ?? el
      if (!HOLD_TITLE.test(container.querySelector('h1')?.textContent ?? '')) return

      const names = Array.from(container.querySelectorAll('h3'))
        .map(heading => heading.textContent?.trim())
        .filter((name): name is string => !!name)

      const note: NoteContext = { deps, sourcePath: ctx.sourcePath }
      for (const heading of Array.from(el.querySelectorAll('h3'))) {
        if (heading.nextElementSibling?.classList.contains(PROPOSAL_BUTTONS_CLASS)) continue
        const name = heading.textContent?.trim()
        if (!name) continue
        heading.after(buttonRow(note, name, names.filter(other => other !== name)))
      }
    })
  }
}

function buttonRow(note: NoteContext, name: string, others: string[]): HTMLElement {
  const row = document.createElement('div')
  row.className = PROPOSAL_BUTTONS_CLASS
  for (const verb of DIRECTION_VERBS) {
    const button = document.createElement('button')
    button.className = PROPOSAL_BUTTON_CLASS
    button.textContent = verb
    button.addEventListener('click', () => {
      if (verb === 'COMBINE') {
        new ProposerPicker(note.deps.app, others, second => void append(note, verb, name, second)).open()
      } else {
        void append(note, verb, name)
      }
    })
    row.append(button)
  }
  return row
}

async function append(note: NoteContext, verb: DirectionVerb, name: string, secondName?: string): Promise<void> {
  const { store, notify } = note.deps
  if (store.at(note.sourcePath) !== 'note') return
  await guardWrite(notify, 'the hold note', async () => {
    await store.process(note.sourcePath, current => appendDirectionLine(current, directionLine(verb, name, secondName)))
    return true
  })
}

/** Which other proposal COMBINE joins with, asked once the button is pressed. */
class ProposerPicker extends FuzzySuggestModal<string> {
  constructor(
    app: App,
    private readonly others: string[],
    private readonly onPick: (name: string) => void,
  ) {
    super(app)
    this.setPlaceholder('Combine with which proposal?')
  }

  getItems(): string[] {
    return this.others
  }

  getItemText(name: string): string {
    return name
  }

  onChooseItem(name: string): void {
    this.onPick(name)
  }
}
