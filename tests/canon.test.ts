import { describe, it, expect } from 'vitest'
import { appendLockedCanon, tickedCanonLines } from '@/run/canon'

/**
 * Canon: the ticks a Direction block carries, and what appending them under
 * LOCKED does to the file. Nothing here touches a vault.
 */

describe('tickedCanonLines', () => {
  it('reads the text of a ticked line, minus its proposer attribution', () => {
    const direction = ['CANON?', '- [x] halo = burden — character-director', '- [ ] permanent cost — gameplay-director'].join('\n')
    expect(tickedCanonLines(direction)).toEqual(['halo = burden'])
  })

  it('reads an upper-case tick the same as a lower-case one', () => {
    expect(tickedCanonLines('- [X] halo = burden — character-director')).toEqual(['halo = burden'])
  })

  it('leaves out every unticked line', () => {
    expect(tickedCanonLines('- [ ] permanent cost — gameplay-director')).toEqual([])
  })

  it('reads a ticked line with no attribution at all', () => {
    expect(tickedCanonLines('- [x] halo = burden')).toEqual(['halo = burden'])
  })

  it('cuts at the last em dash, not the first, when the line’s own text has one', () => {
    const line = '- [x] halo = burden — permanent, not decorative — character-director'
    expect(tickedCanonLines(line)).toEqual(['halo = burden — permanent, not decorative'])
  })

  it('answers nothing for a direction with no CANON? lines', () => {
    expect(tickedCanonLines('KEEP: fast combat\nCHANGE: burden not toolkit')).toEqual([])
  })
})

describe('appendLockedCanon', () => {
  it('starts a fresh file with the three sections when there is none yet', () => {
    const content = appendLockedCanon(undefined, ['halo = burden'])
    expect(content).toContain('## LOCKED\n- halo = burden')
    expect(content).toContain('## UNRESOLVED')
    expect(content).toContain('## REJECTED')
  })

  it('answers the existing file unchanged when there is nothing ticked', () => {
    expect(appendLockedCanon('## LOCKED\n- old line\n\n## UNRESOLVED\n', [])).toBe('## LOCKED\n- old line\n\n## UNRESOLVED\n')
  })

  it('starts a fresh file when nothing is ticked and none exists yet', () => {
    expect(appendLockedCanon(undefined, [])).toContain('## LOCKED')
  })

  it('adds new lines under LOCKED without disturbing the lines already there', () => {
    const existing = '## LOCKED\n- old line\n\n## UNRESOLVED\n- a question\n\n## REJECTED\n- a bad idea\n'
    const content = appendLockedCanon(existing, ['halo = burden'])
    expect(content).toContain('- old line\n- halo = burden')
    expect(content).toContain('## UNRESOLVED\n- a question')
    expect(content).toContain('## REJECTED\n- a bad idea')
  })

  it('adds every ticked line in one write', () => {
    const content = appendLockedCanon('## LOCKED\n\n## UNRESOLVED\n\n## REJECTED\n', ['halo = burden', 'silver, not gold'])
    expect(content).toContain('## LOCKED\n- halo = burden\n- silver, not gold')
  })

  it('adds a LOCKED section to a file that has none, rather than losing what ticked', () => {
    const content = appendLockedCanon('some note with no headings', ['halo = burden'])
    expect(content).toContain('some note with no headings')
    expect(content).toContain('## LOCKED\n- halo = burden')
  })

  it('leaves the file unchanged when the line is already under LOCKED', () => {
    const existing = '## LOCKED\n- halo = burden\n\n## UNRESOLVED\n'
    expect(appendLockedCanon(existing, ['halo = burden'])).toBe(existing)
  })

  it('skips a line a human wrote by hand, compared after trimming', () => {
    const existing = '## LOCKED\n-   halo = burden  \n\n## UNRESOLVED\n'
    expect(appendLockedCanon(existing, ['halo = burden'])).toBe(existing)
  })

  it('adds only the lines not already under LOCKED', () => {
    const existing = '## LOCKED\n- halo = burden\n\n## UNRESOLVED\n'
    const content = appendLockedCanon(existing, ['halo = burden', 'silver, not gold'])
    expect(content).toContain('## LOCKED\n- halo = burden\n- silver, not gold')
  })
})
