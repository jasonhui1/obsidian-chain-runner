import { describe, it, expect } from 'vitest'
import { chooseSeed, seedFromNote } from '@/run/seed'

describe('seedFromNote', () => {
  it('leaves a note with no frontmatter alone', () => {
    expect(seedFromNote('# Premise\nthe body')).toBe('# Premise\nthe body')
  })

  it('drops the frontmatter block, which is the vault bookkeeping and not the argument', () => {
    expect(seedFromNote('---\ntags: [x]\n---\n# Premise\nthe body')).toBe('# Premise\nthe body')
  })

  it('keeps a rule that is not frontmatter, since only the opening block is one', () => {
    expect(seedFromNote('# Premise\n\n---\n\nan aside')).toBe('# Premise\n\n---\n\nan aside')
  })

  it('keeps a note that opens with a rule and never closes a block', () => {
    expect(seedFromNote('---\njust a rule, no close')).toBe('---\njust a rule, no close')
  })

  it('is empty for a note that is only frontmatter', () => {
    expect(seedFromNote('---\ntags: [x]\n---\n')).toBe('')
  })
})

describe('chooseSeed', () => {
  it('runs the whole note when nothing is selected', () => {
    expect(chooseSeed({ noteText: '---\ntags: [x]\n---\nthe body' })).toEqual({
      text: 'the body',
      from: 'note',
    })
  })

  it('runs the selection when there is one, so a passage can be run without splitting the note', () => {
    expect(chooseSeed({ selection: 'one paragraph', noteText: 'the whole note' })).toEqual({
      text: 'one paragraph',
      from: 'selection',
    })
  })

  it('trims the selection, since a drag usually takes the newline after it', () => {
    expect(chooseSeed({ selection: '  a passage \n', noteText: 'the whole note' }).text).toBe('a passage')
  })

  it('treats a whitespace-only selection as no selection at all', () => {
    expect(chooseSeed({ selection: '  \n ', noteText: 'the whole note' })).toEqual({
      text: 'the whole note',
      from: 'note',
    })
  })

  it('leaves a selection alone otherwise — frontmatter inside one was selected on purpose', () => {
    expect(chooseSeed({ selection: '---\ntags: [x]\n---\nthe body', noteText: 'x' }).text).toBe(
      '---\ntags: [x]\n---\nthe body',
    )
  })
})
