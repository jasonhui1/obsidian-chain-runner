import { describe, it, expect } from 'vitest'
import { appendCanon, tickedCanonLines } from '@/run/canon'

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

describe('appendCanon', () => {
  it('starts a fresh file with the three sections when there is none yet', () => {
    const content = appendCanon(undefined, ['halo = burden'])
    expect(content).toContain('## LOCKED\n- halo = burden')
    expect(content).toContain('## UNRESOLVED')
    expect(content).toContain('## REJECTED')
  })

  it('answers the existing file unchanged when there is nothing ticked', () => {
    expect(appendCanon('## LOCKED\n- old line\n\n## UNRESOLVED\n', [])).toBe('## LOCKED\n- old line\n\n## UNRESOLVED\n')
  })

  it('starts a fresh file when nothing is ticked and none exists yet', () => {
    expect(appendCanon(undefined, [])).toContain('## LOCKED')
  })

  it('adds an untagged line under LOCKED without disturbing the lines already there', () => {
    const existing = '## LOCKED\n- old line\n\n## UNRESOLVED\n- a question\n\n## REJECTED\n- a bad idea\n'
    const content = appendCanon(existing, ['halo = burden'])
    expect(content).toContain('- old line\n- halo = burden')
    expect(content).toContain('## UNRESOLVED\n- a question')
    expect(content).toContain('## REJECTED\n- a bad idea')
  })

  it('adds every ticked line in one write', () => {
    const content = appendCanon('## LOCKED\n\n## UNRESOLVED\n\n## REJECTED\n', ['halo = burden', 'silver, not gold'])
    expect(content).toContain('## LOCKED\n- halo = burden\n- silver, not gold')
  })

  it('adds a LOCKED section to a file that has none, rather than losing what ticked', () => {
    const content = appendCanon('some note with no headings', ['halo = burden'])
    expect(content).toContain('some note with no headings')
    expect(content).toContain('## LOCKED\n- halo = burden')
  })

  it('leaves the file unchanged when the line is already under LOCKED', () => {
    const existing = '## LOCKED\n- halo = burden\n\n## UNRESOLVED\n'
    expect(appendCanon(existing, ['halo = burden'])).toBe(existing)
  })

  it('skips a line a human wrote by hand, compared after trimming', () => {
    const existing = '## LOCKED\n-   halo = burden  \n\n## UNRESOLVED\n'
    expect(appendCanon(existing, ['halo = burden'])).toBe(existing)
  })

  it('adds only the lines not already under LOCKED', () => {
    const existing = '## LOCKED\n- halo = burden\n\n## UNRESOLVED\n'
    const content = appendCanon(existing, ['halo = burden', 'silver, not gold'])
    expect(content).toContain('## LOCKED\n- halo = burden\n- silver, not gold')
  })

  it('routes a LOCKED line to LOCKED with the tag stripped', () => {
    const content = appendCanon(undefined, ['LOCKED: The world is a controlled testing environment.'])
    expect(content).toContain('## LOCKED\n- The world is a controlled testing environment.')
  })

  it('routes a REJECTED line to REJECTED with the tag stripped, not to LOCKED', () => {
    const content = appendCanon(undefined, ['REJECTED: Randomized loot or gear drops.'])
    expect(content).toContain('## REJECTED\n- Randomized loot or gear drops.')
    expect(content).not.toContain('## LOCKED\n- REJECTED')
    expect(content).not.toContain('## LOCKED\n- Randomized loot or gear drops.')
  })

  it('routes an UNRESOLVED line to UNRESOLVED with the tag stripped', () => {
    const content = appendCanon(undefined, ['UNRESOLVED: The identity and motivation of the Observer.'])
    expect(content).toContain('## UNRESOLVED\n- The identity and motivation of the Observer.')
    expect(content).not.toContain('## LOCKED\n- UNRESOLVED')
  })

  it('splits one write across sections by each line’s own tag', () => {
    const content = appendCanon(undefined, [
      'LOCKED: The world is a controlled testing environment.',
      'UNRESOLVED: The identity and motivation of the Observer.',
      'REJECTED: Randomized loot or gear drops.',
    ])
    expect(content).toContain('## LOCKED\n- The world is a controlled testing environment.')
    expect(content).toContain('## UNRESOLVED\n- The identity and motivation of the Observer.')
    expect(content).toContain('## REJECTED\n- Randomized loot or gear drops.')
  })

  it('creates a missing REJECTED heading the same way a missing LOCKED heading is created', () => {
    const content = appendCanon('## LOCKED\n- old line\n', ['REJECTED: a bad idea'])
    expect(content).toContain('## LOCKED\n- old line')
    expect(content).toContain('## REJECTED\n- a bad idea')
  })

  it('creates a missing UNRESOLVED heading the same way a missing LOCKED heading is created', () => {
    const content = appendCanon('## LOCKED\n- old line\n', ['UNRESOLVED: an open question'])
    expect(content).toContain('## LOCKED\n- old line')
    expect(content).toContain('## UNRESOLVED\n- an open question')
  })
})
