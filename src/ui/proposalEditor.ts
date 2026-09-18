import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { tags } from '@lezer/highlight'

/**
 * The directing panel's proposal editor: CodeMirror showing markdown as
 * Obsidian's editor does, in Obsidian's own copy of CodeMirror. What each mark
 * looks like is `styles.css`; this only names them.
 */

/** A live editor the panel keeps across its redraws, rather than making a new one. */
export interface ProposalEditor {
  /** The same element for as long as the edit is open; the panel keeps it in one frame. */
  el: HTMLElement
  text(): string
  destroy(): void
}

export function markdownEditor(doc: Document, text: string, changed: () => void): ProposalEditor {
  const el = doc.createElement('div')
  const view = new EditorView({
    parent: el,
    state: EditorState.create({
      doc: text,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(MARKS),
        EditorView.lineWrapping,
        EditorView.updateListener.of(update => update.docChanged && changed()),
      ],
    }),
  })
  return {
    el,
    text: () => view.state.doc.toString(),
    destroy: () => {
      view.destroy()
      el.remove()
    },
  }
}

/** `chain-runner-md-mark` is every marker Obsidian leaves visible: `##`, `**`, a bullet. */
const MARKS = HighlightStyle.define([
  { tag: tags.heading1, class: 'chain-runner-md-h1' },
  { tag: tags.heading2, class: 'chain-runner-md-h2' },
  { tag: tags.heading3, class: 'chain-runner-md-h3' },
  { tag: tags.heading4, class: 'chain-runner-md-h4' },
  { tag: tags.heading5, class: 'chain-runner-md-h5' },
  { tag: tags.heading6, class: 'chain-runner-md-h6' },
  { tag: tags.strong, class: 'chain-runner-md-strong' },
  { tag: tags.emphasis, class: 'chain-runner-md-emphasis' },
  { tag: tags.strikethrough, class: 'chain-runner-md-struck' },
  { tag: tags.monospace, class: 'chain-runner-md-code' },
  { tag: tags.quote, class: 'chain-runner-md-quote' },
  { tag: tags.list, class: 'chain-runner-md-list' },
  { tag: [tags.link, tags.url], class: 'chain-runner-md-link' },
  { tag: tags.processingInstruction, class: 'chain-runner-md-mark' },
])
