import { describe, it, expect } from 'vitest'
import { seedFromNote } from '@/run/seed'

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
