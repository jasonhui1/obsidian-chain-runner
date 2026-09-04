// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { PanelBody } from '@/ui/panelBody'

/**
 * A panel's answer rendered block by block while it streams (ADR-0008). What
 * matters is that a settled block is never touched again — that is the selection
 * a reader keeps — and that settling renders the answer whole, in one pass.
 */

interface Render {
  text: string
  released: boolean
}

let el: HTMLElement
let renders: Render[]

function body(): PanelBody {
  return new PanelBody(el, (text, into) => {
    const render: Render = { text, released: false }
    renders.push(render)
    into.append(document.createTextNode(text))
    return () => void (render.released = true)
  })
}

const drawn = (): string[] => renders.filter(render => !render.released).map(render => render.text)

beforeEach(() => {
  el = document.createElement('div')
  document.body.replaceChildren(el)
  renders = []
})

describe('a body that is still being written', () => {
  it('renders the text it is given', () => {
    body().stream('half a sen')
    expect(el.textContent).toBe('half a sen')
  })

  it('re-renders only the tail as the answer grows', () => {
    const view = body()
    view.stream('settled\n\nhalf a sen')
    const before = renders.length
    view.stream('settled\n\nhalf a sentence')
    expect(renders.slice(before).map(render => render.text)).toEqual(['half a sentence'])
  })

  it('leaves the element of a settled block alone, so a selection in it survives', () => {
    const view = body()
    view.stream('settled\n\nhalf')
    const first = el.firstElementChild
    view.stream('settled\n\nhalf a sentence')
    expect(el.firstElementChild).toBe(first)
  })

  it('does not re-render a block for the blank line that closed it', () => {
    const view = body()
    view.stream('one')
    view.stream('one\n\n')
    view.stream('one\n\ntwo')
    expect(renders.map(render => render.text)).toEqual(['one', 'two'])
  })

  it('releases the render of a tail it replaces', () => {
    const view = body()
    view.stream('half')
    view.stream('half a sentence')
    expect(renders.map(render => render.released)).toEqual([true, false])
  })

  it('does nothing at all for text that did not change', () => {
    const view = body()
    view.stream('one\n\ntwo')
    view.stream('one\n\ntwo')
    expect(renders.length).toBe(2)
  })

  it('holds nothing for no text', () => {
    body().stream('')
    expect(renders).toEqual([])
    expect(el.childElementCount).toBe(0)
  })
})

describe('a body whose answer has landed', () => {
  it('renders the whole answer in one pass, so nothing is left block-local', () => {
    const view = body()
    view.stream('one\n\ntwo')
    const before = renders.length
    view.settle('one\n\ntwo')
    expect(renders.slice(before).map(render => render.text)).toEqual(['one\n\ntwo'])
    expect(drawn()).toEqual(['one\n\ntwo'])
  })

  it('drops the blocks the streaming render left', () => {
    const view = body()
    view.stream('one\n\ntwo\n\nthree')
    view.settle('one\n\ntwo\n\nthree')
    expect(el.childElementCount).toBe(1)
    expect(el.textContent).toBe('one\n\ntwo\n\nthree')
  })

  it('settles once when it is drawn twice unchanged', () => {
    const view = body()
    view.settle('landed')
    view.settle('landed')
    expect(renders.length).toBe(1)
  })

  it('releases everything it holds', () => {
    const view = body()
    view.settle('landed')
    view.release()
    expect(renders.every(render => render.released)).toBe(true)
    expect(el.childElementCount).toBe(0)
  })
})
