import { describe, it, expect } from 'vitest'
import {
  MarkSelection,
  keptNoteContent,
  keptNotePath,
  markedRanges,
  mergeRanges,
  trimToMarks,
} from '@/run/keepMarks'

/**
 * What marks mean: text and ranges in, the kept text out. The vault half is
 * `keepMarksActions.test.ts`.
 */

const TEXT = ['one', 'two', 'three', 'four', 'five'].join('\n')

describe('trimming to marks', () => {
  it('keeps a single passage as it stands', () => {
    expect(trimToMarks(TEXT, [{ from: 1, to: 2 }])).toBe('two\nthree')
  })

  it('reads adjacent ranges as one passage, with no break between them', () => {
    expect(trimToMarks(TEXT, [{ from: 0, to: 1 }, { from: 2, to: 3 }])).toBe('one\ntwo\nthree\nfour')
  })

  it('merges overlapping ranges rather than repeating the lines they share', () => {
    expect(trimToMarks(TEXT, [{ from: 0, to: 2 }, { from: 1, to: 3 }])).toBe('one\ntwo\nthree\nfour')
  })

  it('puts a blank line between passages that were apart', () => {
    expect(trimToMarks(TEXT, [{ from: 0, to: 0 }, { from: 3, to: 3 }])).toBe('one\n\nfour')
  })

  it('takes the ranges in reading order, however they were marked', () => {
    expect(trimToMarks(TEXT, [{ from: 4, to: 4 }, { from: 0, to: 0 }])).toBe('one\n\nfive')
  })

  it('is empty when nothing is marked', () => {
    expect(trimToMarks(TEXT, [])).toBe('')
  })

  it('is empty when the marks hold nothing but blank lines', () => {
    expect(trimToMarks('a\n\n\nb', [{ from: 1, to: 2 }])).toBe('')
  })

  it('clamps a range that runs past the end of the text', () => {
    expect(trimToMarks(TEXT, [{ from: 3, to: 99 }])).toBe('four\nfive')
  })

  it('drops a range that ends before it starts', () => {
    expect(trimToMarks(TEXT, [{ from: 3, to: 1 }])).toBe('')
  })

  it('leaves each kept line the indent it was written with', () => {
    const list = ['- one', '    - nested', '', 'after'].join('\n')
    expect(trimToMarks(list, [{ from: 0, to: 2 }])).toBe('- one\n    - nested')
  })

  it('reads a note written with carriage returns the same way', () => {
    expect(trimToMarks('one\r\ntwo\r\nthree', [{ from: 1, to: 1 }])).toBe('two')
  })
})

describe('ranges', () => {
  it('makes one range of consecutive marked lines', () => {
    expect(markedRanges([2, 0, 1])).toEqual([{ from: 0, to: 2 }])
  })

  it('leaves a gap between lines that are not consecutive', () => {
    expect(markedRanges([0, 2])).toEqual([{ from: 0, to: 0 }, { from: 2, to: 2 }])
  })

  it('leaves an empty list empty', () => {
    expect(mergeRanges([])).toEqual([])
  })
})

describe('a marking session', () => {
  it('marks a line by click, and unmarks it by clicking again', () => {
    const selection = new MarkSelection(TEXT)
    selection.toggle(2)
    expect(selection.isMarked(2)).toBe(true)
    selection.toggle(2)
    expect(selection.isMarked(2)).toBe(false)
    expect(selection.count).toBe(0)
  })

  it('marks the current line by keyboard, and moves it with the arrows', () => {
    const selection = new MarkSelection(TEXT)
    selection.move(1)
    selection.toggleCurrent()
    selection.move(1)
    selection.toggleCurrent()
    expect(selection.cursor).toBe(2)
    expect(selection.ranges()).toEqual([{ from: 1, to: 2 }])
  })

  it('leaves the cursor on the line just clicked, so the keyboard carries on from there', () => {
    const selection = new MarkSelection(TEXT)
    selection.toggle(3)
    expect(selection.cursor).toBe(3)
  })

  it('stops the cursor at either end rather than wrapping', () => {
    const selection = new MarkSelection(TEXT)
    selection.move(-1)
    expect(selection.cursor).toBe(0)
    selection.move(99)
    expect(selection.cursor).toBe(4)
  })

  it('ignores a line the text does not have', () => {
    const selection = new MarkSelection(TEXT)
    selection.toggle(9)
    expect(selection.count).toBe(0)
    expect(selection.cursor).toBe(0)
  })

  it('marks nothing until a line is marked', () => {
    expect(new MarkSelection(TEXT).ranges()).toEqual([])
  })
})

describe('a note trimmed from a note', () => {
  it('names the note it was trimmed from, as a link', () => {
    expect(keptNoteContent('two', { note: 'premise' })).toBe('---\nkept from: "[[premise]]"\n---\n\ntwo\n')
  })

  it('goes beside the note it was trimmed from', () => {
    expect(keptNotePath('notes/ideas/premise.md', 'premise')).toBe('notes/ideas/premise (kept).md')
  })

  it('goes in the vault root when the note is there', () => {
    expect(keptNotePath('premise.md', 'premise')).toBe('premise (kept).md')
  })
})
