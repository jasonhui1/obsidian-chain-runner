// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { KeyedChildren } from '@/ui/keyed'

/**
 * Drawing by key rather than by rebuild (ADR-0007). What matters is that an
 * element survives a draw that still wants it, that order follows the draw, and
 * that what is dropped is released.
 */

let parent: HTMLElement
let made: string[]
let removed: string[]

function children(): KeyedChildren {
  made = []
  removed = []
  return new KeyedChildren({
    make: key => {
      made.push(key)
      const el = document.createElement('div')
      el.dataset.key = key
      return el
    },
    onRemove: key => void removed.push(key),
  })
}

const keys = (): string[] => Array.from(parent.children, el => (el as HTMLElement).dataset.key ?? '')

beforeEach(() => {
  parent = document.createElement('div')
  document.body.replaceChildren(parent)
})

describe('KeyedChildren', () => {
  it('hands back the same element on the next draw', () => {
    const kids = children()
    const first = kids.use('a', parent).el
    kids.end()
    const again = kids.use('a', parent)
    kids.end()
    expect(again.el).toBe(first)
    expect(again.fresh).toBe(false)
    expect(made).toEqual(['a'])
  })

  it('says an element is fresh only on the draw that made it', () => {
    const kids = children()
    expect(kids.use('a', parent).fresh).toBe(true)
  })

  it('drops what a draw did not ask for, and says so', () => {
    const kids = children()
    kids.use('a', parent)
    kids.use('b', parent)
    kids.end()
    kids.use('a', parent)
    kids.end()
    expect(keys()).toEqual(['a'])
    expect(removed).toEqual(['b'])
  })

  it('orders the children by the order the draw used them', () => {
    const kids = children()
    kids.use('a', parent)
    kids.use('b', parent)
    kids.end()
    kids.use('b', parent)
    kids.use('a', parent)
    kids.end()
    expect(keys()).toEqual(['b', 'a'])
  })

  it('moves an element that changed parent, keeping it the same element', () => {
    const other = document.createElement('div')
    document.body.append(other)
    const kids = children()
    const el = kids.use('a', parent).el
    kids.end()
    kids.use('a', other)
    kids.end()
    expect(other.children[0]).toBe(el)
    expect(parent.children.length).toBe(0)
  })

  it('leaves an element where it is, so a focused one keeps the focus', () => {
    const kids = children()
    const el = kids.use('a', parent).el
    kids.end()
    el.tabIndex = 0
    el.focus()
    kids.use('a', parent)
    kids.end()
    expect(document.activeElement).toBe(el)
  })

  it('releases everything on a clear, for a draw that can reuse none of it', () => {
    const kids = children()
    kids.use('a', parent)
    kids.end()
    kids.clear()
    expect(removed).toEqual(['a'])
    expect(keys()).toEqual([])
    expect(kids.use('a', parent).fresh).toBe(true)
  })
})
