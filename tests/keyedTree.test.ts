// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { KeyedTree } from '@/ui/keyedTree'

/**
 * A panel drawn by key through its whole tree (ADR-0007): an element survives a
 * draw that places it again, whether named or counted, and what it holds goes with it.
 */

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.replaceChildren(root)
})

describe('KeyedTree', () => {
  it('hands back the same elements, named or counted, on the next draw', () => {
    const tree = new KeyedTree()
    const draw = (): HTMLElement[] => {
      const section = tree.place(root, 'div', 'section', 'chat').el
      const drawn = [section, tree.place(section, 'p').el, tree.place(section, 'p').el]
      tree.end()
      return drawn
    }
    const first = draw()
    const again = draw()
    again.forEach((el, index) => expect(el).toBe(first[index]))
  })

  it('tells apart the same key under different parents', () => {
    const tree = new KeyedTree()
    const a = tree.place(root, 'div', '', 'a').el
    const b = tree.place(root, 'div', '', 'b').el
    expect(tree.place(a, 'p', '', 'line').el).not.toBe(tree.place(b, 'p', '', 'line').el)
  })

  it('lets go of what an element holds when a draw leaves it out', () => {
    const tree = new KeyedTree()
    let released = 0
    tree.bind(tree.place(root, 'div').el, () => void released++)
    tree.end()
    tree.end()
    expect(released).toBe(1)
    expect(root.children).toHaveLength(0)
  })

  it('has a timer do what the latest draw said', () => {
    const tree = new KeyedTree()
    const el = tree.place(root, 'div').el
    const said: string[] = []
    const tick = tree.latest(el, () => void said.push('first'))
    tree.latest(el, () => void said.push('second'))
    tick()
    expect(said).toEqual(['second'])
  })
})
