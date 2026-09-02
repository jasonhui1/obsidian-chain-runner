import { describe, it, expect } from 'vitest'
import { extractSection, slugify } from '@/run/section'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('  The Summary! ')).toBe('the-summary')
  })
})

describe('extractSection', () => {
  const doc = ['# Title', 'intro', '', '## Summary', 'the short version', '', '## Notes', 'aside'].join('\n')

  it('returns the body of the matching heading, up to the next one', () => {
    expect(extractSection(doc, 'summary')).toBe('the short version')
  })

  it('matches on the heading slug, not its exact text', () => {
    expect(extractSection(doc, 'The Summary')).toBe('')
    expect(extractSection('## The Summary\nx', 'the-summary')).toBe('x')
  })

  it('runs to the end of the document when nothing follows', () => {
    expect(extractSection(doc, 'notes')).toBe('aside')
  })

  it('is empty when the section is not there', () => {
    expect(extractSection(doc, 'skeleton')).toBe('')
  })
})
