import { describe, it, expect } from 'vitest'
import { PURPOSE_HEADINGS, pickerRows, type Matcher } from '@/ui/pickerModel'
import type { ChainSummary } from '@/engine/types'

/** Stands in for Obsidian's fuzzy search: a substring hit, scored by how early it lands. */
function substring(query: string): Matcher {
  const needle = query.toLowerCase()
  return text => {
    const at = text.toLowerCase().indexOf(needle)
    return at === -1 ? null : 1 / (1 + at)
  }
}

const chains: ChainSummary[] = [
  { slug: 'relay', name: 'Telephone Relay', purpose: 'insight', moment: 'finalizing a doc' },
  { slug: 'brief', name: 'Write Brief', purpose: 'production', moment: 'handing work over' },
  { slug: 'premises', name: 'Unstated Premises', purpose: 'stress-test', moment: 'a premise feels safe' },
  { slug: 'scratch', name: 'Scratch', description: 'no purpose declared' },
]

describe('pickerRows: no query', () => {
  const rows = pickerRows(chains, '', substring)

  it('shows every chain', () => {
    expect(rows.map(r => r.chain.slug)).toEqual(['relay', 'brief', 'premises', 'scratch'])
  })

  it('groups by purpose, in the order the headings are declared', () => {
    expect(rows.map(r => r.heading)).toEqual(PURPOSE_HEADINGS.map(h => h.heading))
  })

  it('files a chain that declares no purpose under the fourth heading, not inside one it never chose', () => {
    const scratch = rows.find(r => r.chain.slug === 'scratch')
    expect(scratch?.heading).toBe(PURPOSE_HEADINGS[3].heading)
  })

  it('marks the first row of each group, so the heading is drawn once', () => {
    expect(rows.map(r => r.groupStart)).toEqual([true, true, true, true])
  })

  it('leads each row with the moment, which is what says when to reach for it', () => {
    expect(rows[0].note).toBe('finalizing a doc')
  })

  it('falls back to the description when a chain states no moment', () => {
    expect(rows[3].note).toBe('no purpose declared')
  })

  it('says a chain that declares no seed will not read the note it was run on', () => {
    const pinned: ChainSummary[] = [{ slug: 'p', name: 'Pinned', seeded: false }]
    expect(pickerRows(pinned, '', substring)[0].readsNote).toBe(false)
  })

  it('assumes a chain reads the note when the workspace said nothing either way', () => {
    expect(rows[0].readsNote).toBe(true)
  })
})

describe('pickerRows: a query', () => {
  it('filters across the groups', () => {
    const rows = pickerRows(chains, 'premise', substring)
    expect(rows.map(r => r.chain.slug)).toEqual(['premises'])
  })

  it('drops a heading whose chains all filtered out', () => {
    const rows = pickerRows(chains, 'premise', substring)
    expect(rows.map(r => r.heading)).toEqual([PURPOSE_HEADINGS[2].heading])
  })

  it('matches the moment as well as the name, since that is what a reader remembers', () => {
    const rows = pickerRows(chains, 'handing work', substring)
    expect(rows.map(r => r.chain.slug)).toEqual(['brief'])
  })

  it('matches the slug, for someone who knows the file', () => {
    expect(pickerRows(chains, 'relay', substring).map(r => r.chain.slug)).toEqual(['relay'])
  })

  it('orders within a group by how well each chain matched', () => {
    const two: ChainSummary[] = [
      { slug: 'a', name: 'A distant premise', purpose: 'insight' },
      { slug: 'b', name: 'Premise first', purpose: 'insight' },
    ]
    expect(pickerRows(two, 'premise', substring).map(r => r.chain.slug)).toEqual(['b', 'a'])
  })

  it('keeps the group order whatever the scores, so the headings do not shuffle', () => {
    const rows = pickerRows(chains, 'e', substring)
    const headings = [...new Set(rows.map(r => r.heading))]
    expect(headings).toEqual(PURPOSE_HEADINGS.filter(h => headings.includes(h.heading)).map(h => h.heading))
  })

  it('is empty when nothing matches', () => {
    expect(pickerRows(chains, 'zzz', substring)).toEqual([])
  })
})
