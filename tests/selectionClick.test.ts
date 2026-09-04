import { describe, it, expect } from 'vitest'
import { SelectionClicks, selectedOne } from '@/ui/selectionClick'

/**
 * When a change on the drawing counts as a click on one thing. Excalidraw's
 * scene-change hook fires on every change, so everything this decides is what
 * keeps a rubber-band or a redraw from popping a picker (ADR-0010).
 */

describe('selectedOne', () => {
  it('is the one selected id', () => {
    expect(selectedOne({ a: true })).toBe('a')
  })

  it('is nothing when the drawing says nothing is selected', () => {
    expect(selectedOne({})).toBeUndefined()
    expect(selectedOne(undefined)).toBeUndefined()
  })

  it('is nothing when more than one is selected, so a rubber-band is not a click', () => {
    expect(selectedOne({ a: true, b: true })).toBeUndefined()
  })

  it('ignores ids Excalidraw has switched off rather than removed', () => {
    expect(selectedOne({ a: true, b: false })).toBe('a')
  })
})

describe('SelectionClicks', () => {
  it('reads a newly selected element as a click', () => {
    expect(new SelectionClicks().clicked({ a: true })).toBe('a')
  })

  it('does not read the same selection reported twice as two clicks', () => {
    const clicks = new SelectionClicks()
    clicks.clicked({ a: true })
    expect(clicks.clicked({ a: true })).toBeUndefined()
  })

  it('reads the next element as a click when the selection moves', () => {
    const clicks = new SelectionClicks()
    clicks.clicked({ a: true })
    expect(clicks.clicked({ b: true })).toBe('b')
  })

  it('reads the same element again once something else has been selected', () => {
    const clicks = new SelectionClicks()
    clicks.clicked({ a: true })
    clicks.clicked({})
    expect(clicks.clicked({ a: true })).toBe('a')
  })

  it('is not a click when several are selected, and does not swallow the next one', () => {
    const clicks = new SelectionClicks()
    expect(clicks.clicked({ a: true, b: true })).toBeUndefined()
    expect(clicks.clicked({ a: true })).toBe('a')
  })

  it('is not a click when the selection is cleared', () => {
    const clicks = new SelectionClicks()
    clicks.clicked({ a: true })
    expect(clicks.clicked({})).toBeUndefined()
  })
})
