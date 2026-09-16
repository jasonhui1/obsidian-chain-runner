// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { EditorView } from '@codemirror/view'
import { markdownEditor } from '@/ui/proposalEditor'

/**
 * The proposal editor: that it holds the words, reports a change, keeps them
 * when the panel moves it, and marks up markdown the way the panel styles it.
 */

let host: HTMLElement
let changes: number

const open = (text: string): ReturnType<typeof markdownEditor> => {
  const editor = markdownEditor(document, text, () => void changes++)
  host.append(editor.el)
  return editor
}

const marked = (cls: string): string[] =>
  Array.from(host.querySelectorAll(`.${cls}`)).map(el => el.textContent ?? '')

/** Types over everything in the editor, the way the reader's keys reach it. */
const retype = (editor: { el: HTMLElement }, words: string): void => {
  const view = EditorView.findFromDOM(editor.el)
  if (!view) throw new Error('the editor has no view')
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: words } })
}

beforeEach(() => {
  document.body.replaceChildren()
  host = document.body.appendChild(document.createElement('div'))
  changes = 0
})

describe('the proposal editor', () => {
  it('opens holding the proposal’s words', () => {
    const editor = open('A controlled test.\n\nWith a second line.')
    expect(editor.text()).toBe('A controlled test.\n\nWith a second line.')
    expect(host.textContent).toContain('A controlled test.')
    editor.destroy()
  })

  it('reports every change, and hands back the words as they now read', () => {
    const editor = open('Before.')
    retype(editor, 'After.')
    expect(changes).toBe(1)
    expect(editor.text()).toBe('After.')
    editor.destroy()
  })

  it('keeps its words when the panel takes it out and puts it back', () => {
    const editor = open('Half an edit')
    editor.el.remove()
    host.replaceChildren()
    host.append(editor.el)
    expect(editor.text()).toBe('Half an edit')
    expect(host.contains(editor.el)).toBe(true)
    editor.destroy()
  })

  it('marks a heading at its level, with the ## still there', () => {
    const editor = open('## A heading\n')
    expect(marked('chain-runner-md-h2').join('')).toContain('A heading')
    expect(marked('chain-runner-md-mark')).toContain('##')
    editor.destroy()
  })

  it('marks bold, italic and code, keeping their markers', () => {
    const editor = open('**bold** and *italic* and `code`\n')
    expect(marked('chain-runner-md-strong').join('')).toContain('bold')
    expect(marked('chain-runner-md-emphasis').join('')).toContain('italic')
    expect(marked('chain-runner-md-code').join('')).toContain('code')
    expect(host.textContent).toContain('**bold**')
    editor.destroy()
  })

  it('marks a list’s bullet', () => {
    const editor = open('- one\n- two\n')
    expect(marked('chain-runner-md-mark')).toContain('-')
    editor.destroy()
  })

  it('takes its own element away when it is destroyed', () => {
    const editor = open('Gone soon.')
    editor.destroy()
    expect(host.querySelector('.cm-editor')).toBeNull()
  })
})
