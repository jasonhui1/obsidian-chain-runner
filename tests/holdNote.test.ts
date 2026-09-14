import { describe, it, expect } from 'vitest'
import { holdNoteContent, holdNotePath, mergeHoldNote, type HoldNoteInput } from '@/run/holdNote'
import type { LayoutPanel } from '@/engine/types'

/**
 * The hold-note convention: a run's panels in, the note's markdown out. Nothing
 * here touches a vault.
 */

const panel = (over: Partial<LayoutPanel> = {}): LayoutPanel => ({
  name: 'character-director',
  node: 'character',
  text: 'Shrine-maiden silhouette.',
  lines: 1,
  state: 'filled',
  ...over,
})

const input = (over: Partial<HoldNoteInput> = {}): HoldNoteInput => ({
  runId: '2026-09-15-Ab3dE1',
  chainName: 'creative-director',
  panels: [panel()],
  thoughts: {},
  ...over,
})

describe('holdNotePath', () => {
  it('files the hold under the fixed folder, keyed by run id', () => {
    expect(holdNotePath('2026-09-15-Ab3dE1')).toBe('Maestro/holds/2026-09-15-Ab3dE1.md')
  })

  it('keeps the run id readable, minus what a filename cannot hold', () => {
    expect(holdNotePath('run/with:bad*chars')).toBe('Maestro/holds/run-with-bad-chars.md')
  })
})

describe('holdNoteContent', () => {
  it('names the run and the chain, and says why it stopped', () => {
    const content = holdNoteContent(input())
    expect(content).toContain('# Hold: run 2026-09-15-Ab3dE1 · creative-director')
    expect(content).toContain('Stopped because: chain ended at its declared outputs.')
  })

  it('renders the join panel as the verdict, not as a proposal', () => {
    const verdict = panel({ name: 'creative-director', node: 'decider', text: 'Halo = stance-switching combat.', emphasis: 'join' })
    const content = holdNoteContent(input({ panels: [panel(), verdict] }))
    expect(content).toContain('## Verdict (creative-director)')
    expect(content).toContain('Halo = stance-switching combat.')
    expect(content).not.toContain('### creative-director')
  })

  it('leaves out the verdict section when no panel converges', () => {
    expect(holdNoteContent(input())).not.toContain('## Verdict')
  })

  it('gives every non-join panel its own proposal section', () => {
    const content = holdNoteContent(
      input({ panels: [panel(), panel({ name: 'gameplay-director', node: 'gameplay', text: 'Stances mapped to segments.' })] }),
    )
    expect(content).toContain('### character-director')
    expect(content).toContain('Shrine-maiden silhouette.')
    expect(content).toContain('### gameplay-director')
    expect(content).toContain('Stances mapped to segments.')
  })

  it('folds a proposer’s stored thought, read-only, ahead of its proposal', () => {
    const content = holdNoteContent(input({ thoughts: { character: 'Considered a crown motif first.' } }))
    expect(content).toContain('<summary>thinking</summary>')
    expect(content).toContain('Considered a crown motif first.')
    const thinkIndex = content.indexOf('<summary>thinking</summary>')
    const proposalIndex = content.indexOf('Shrine-maiden silhouette.')
    expect(thinkIndex).toBeLessThan(proposalIndex)
  })

  it('leaves the fold out for a panel with no stored thought', () => {
    expect(holdNoteContent(input())).not.toContain('<details>')
  })

  it('writes every Direction line as an empty prompt', () => {
    const content = holdNoteContent(input())
    for (const word of ['KEEP', 'CHANGE', 'KILL', 'PUSH', 'REDUCE', 'MUTATE', 'COMBINE']) {
      expect(content).toContain(`${word}:`)
    }
  })

  it('builds a CANON? checkbox per line a proposer offered', () => {
    const withCanon = panel({ text: 'Silhouette text.\n\n## Proposed canon\n- halo = crown\n- silver, not gold' })
    const content = holdNoteContent(input({ panels: [withCanon] }))
    expect(content).toContain('CANON?')
    expect(content).toContain('- [ ] halo = crown — character-director')
    expect(content).toContain('- [ ] silver, not gold — character-director')
  })

  it('leaves CANON? out when no proposer offered one', () => {
    expect(holdNoteContent(input())).not.toContain('CANON?')
  })

  it('ends with an empty Conversation section', () => {
    const content = holdNoteContent(input())
    expect(content.trimEnd().endsWith('## Conversation')).toBe(true)
  })
})

describe('mergeHoldNote', () => {
  it('takes the fresh note whole when there is no previous one', () => {
    const fresh = holdNoteContent(input())
    expect(mergeHoldNote(fresh, undefined)).toBe(fresh)
  })

  it('keeps the human’s Direction, and everything after it, over the fresh template', () => {
    const fresh = holdNoteContent(input())
    const previous = fresh.replace(
      '## Direction\nKEEP:\nCHANGE:',
      '## Direction\nKEEP: fast combat\nCHANGE: burden not toolkit',
    )
    const merged = mergeHoldNote(fresh, previous)
    expect(merged).toContain('KEEP: fast combat')
    expect(merged).toContain('CHANGE: burden not toolkit')
  })

  it('keeps a Conversation the human already started', () => {
    const fresh = holdNoteContent(input())
    const previous = fresh.replace('## Conversation\n', '## Conversation\n@gameplay-director defend this.\n')
    expect(mergeHoldNote(fresh, previous)).toContain('@gameplay-director defend this.')
  })

  it('still shows this run’s own proposals and verdict, not the previous note’s', () => {
    const fresh = holdNoteContent(input({ panels: [panel({ text: 'revised text' })] }))
    const previous = holdNoteContent(input({ panels: [panel({ text: 'stale text' })] }))
    const merged = mergeHoldNote(fresh, previous)
    expect(merged).toContain('revised text')
    expect(merged).not.toContain('stale text')
  })

  it('falls back to the fresh note when the previous one has no Direction heading', () => {
    const fresh = holdNoteContent(input())
    expect(mergeHoldNote(fresh, 'a note that is not a hold at all')).toBe(fresh)
  })
})
