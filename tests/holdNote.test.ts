import { describe, it, expect } from 'vitest'
import {
  appendDirectionLine,
  appendResumeLink,
  directionBlock,
  directionLine,
  holdHeading,
  holdNoteContent,
  holdNotePath,
  mergeHoldNote,
  editsToCarry,
  proposalEdits,
  refreshHoldNote,
  reranFrom,
  type HoldNoteInput,
} from '@/run/holdNote'
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

describe('mergeHoldNote CANON? refresh', () => {
  const proposalWith = (lines: string[]) =>
    panel({ text: `Silhouette text.\n\n## Proposed canon\n${lines.map(line => `- ${line}`).join('\n')}` })
  const tick = (content: string, line: string) =>
    content.replace(`- [ ] ${line} — character-director`, `- [x] ${line} — character-director`)

  it('keeps a tick on a line the new proposals still offer', () => {
    const fresh = holdNoteContent(input({ panels: [proposalWith(['halo = crown', 'silver, not gold'])] }))
    const previous = tick(fresh, 'halo = crown')
    expect(mergeHoldNote(fresh, previous)).toContain('- [x] halo = crown — character-director')
  })

  it('adds a new line unticked', () => {
    const fresh = holdNoteContent(input({ panels: [proposalWith(['halo = crown', 'silver, not gold'])] }))
    const previous = holdNoteContent(input({ panels: [proposalWith(['halo = crown'])] }))
    expect(mergeHoldNote(fresh, previous)).toContain('- [ ] silver, not gold — character-director')
  })

  it('drops an unticked line no proposal offers any more', () => {
    const fresh = holdNoteContent(input({ panels: [proposalWith(['silver, not gold'])] }))
    const previous = holdNoteContent(input({ panels: [proposalWith(['halo = crown', 'silver, not gold'])] }))
    expect(mergeHoldNote(fresh, previous)).not.toContain('halo = crown')
  })

  it('keeps a ticked line no proposal offers any more', () => {
    const fresh = holdNoteContent(input({ panels: [proposalWith(['silver, not gold'])] }))
    const stale = holdNoteContent(input({ panels: [proposalWith(['halo = crown', 'silver, not gold'])] }))
    const previous = tick(stale, 'halo = crown')
    expect(mergeHoldNote(fresh, previous)).toContain('- [x] halo = crown — character-director')
  })

  it('introduces a checklist the previous note had none of', () => {
    const fresh = holdNoteContent(input({ panels: [proposalWith(['halo = crown'])] }))
    const previous = holdNoteContent(input())
    const merged = mergeHoldNote(fresh, previous)
    expect(merged).toContain('CANON?')
    expect(merged).toContain('- [ ] halo = crown — character-director')
  })

  it('leaves KEEP/CHANGE lines and free text in Direction untouched', () => {
    const fresh = holdNoteContent(input({ panels: [proposalWith(['halo = crown'])] }))
    const previous = tick(fresh, 'halo = crown').replace('KEEP:\n', 'KEEP: fast combat\n')
    const merged = mergeHoldNote(fresh, previous)
    expect(merged).toContain('KEEP: fast combat')
    expect(merged).toContain('- [x] halo = crown — character-director')
  })

  it('keeps a Conversation the human already started, canon and all', () => {
    const fresh = holdNoteContent(input({ panels: [proposalWith(['halo = crown'])] }))
    const previous = tick(fresh, 'halo = crown').replace('## Conversation\n', '## Conversation\n@gameplay-director defend this.\n')
    const merged = mergeHoldNote(fresh, previous)
    expect(merged).toContain('@gameplay-director defend this.')
    expect(merged).toContain('- [x] halo = crown — character-director')
  })
})

describe('directionBlock', () => {
  it('answers undefined for a note with no Direction heading at all', () => {
    expect(directionBlock('just some words')).toBeUndefined()
  })

  it('reads the Direction section verbatim, CANON? ticks included', () => {
    const content = [
      '## Direction',
      'KEEP: fast combat',
      'CHANGE: burden not toolkit',
      '',
      'CANON?',
      '- [x] halo = burden — character-director',
      '',
      '## Conversation',
      '',
    ].join('\n')
    const block = directionBlock(content)
    expect(block).toContain('KEEP: fast combat')
    expect(block).toContain('CANON?')
    expect(block).toContain('- [x] halo = burden — character-director')
    expect(block).not.toContain('## Conversation')
  })

  it('reads a fresh template’s Direction, all-empty, rather than saying there is none', () => {
    expect(directionBlock(holdNoteContent(input()))).toContain('KEEP:')
  })
})

describe('directionLine', () => {
  it('names the proposal the verb was pressed on', () => {
    expect(directionLine('KEEP', 'character-director')).toBe('KEEP: character-director')
  })

  it('names a second proposal for COMBINE', () => {
    expect(directionLine('COMBINE', 'character-director', 'gameplay-director')).toBe('COMBINE: character-director + gameplay-director')
  })
})

describe('appendDirectionLine', () => {
  it('leaves a note with no Direction heading unchanged', () => {
    expect(appendDirectionLine('just some words', 'KEEP: character-director')).toBe('just some words')
  })

  it('appends after the template’s own verb lines, ahead of the next heading', () => {
    const content = holdNoteContent(input())
    const appended = appendDirectionLine(content, 'KEEP: character-director')
    expect(appended).toContain('COMBINE:\nKEEP: character-director\n\n## Conversation')
  })

  it('appends after CANON? ticks the human already made, not before them', () => {
    const content = [
      '## Direction',
      'KEEP:',
      '',
      'CANON?',
      '- [x] halo = burden — character-director',
      '',
      '## Conversation',
      '',
    ].join('\n')
    const appended = appendDirectionLine(content, 'KILL: gameplay-director')
    const canonAt = appended.indexOf('- [x] halo = burden')
    const appendedAt = appended.indexOf('KILL: gameplay-director')
    expect(canonAt).toBeGreaterThan(-1)
    expect(appendedAt).toBeGreaterThan(canonAt)
  })

  it('stacks a second press under the first', () => {
    const once = appendDirectionLine(holdNoteContent(input()), 'KEEP: character-director')
    const twice = appendDirectionLine(once, 'KILL: gameplay-director')
    expect(twice).toContain('KEEP: character-director\nKILL: gameplay-director')
  })

  it('leaves the rest of the note, Conversation included, untouched', () => {
    const content = holdNoteContent(input()).replace('## Conversation\n', '## Conversation\n@gameplay-director defend this.\n')
    const appended = appendDirectionLine(content, 'KEEP: character-director')
    expect(appended).toContain('@gameplay-director defend this.')
  })
})

describe('holdHeading', () => {
  it('reads the run and chain a hold note was written for', () => {
    expect(holdHeading(holdNoteContent(input()))).toEqual({ runId: '2026-09-15-Ab3dE1', chainName: 'creative-director' })
  })

  it('answers undefined for a note that is not a hold', () => {
    expect(holdHeading('# Something else\n')).toBeUndefined()
  })
})

describe('proposalEdits', () => {
  const gameplay = panel({ name: 'gameplay-director', node: 'gameplay', text: 'Stances mapped to segments.\n\n## Proposed canon\n- stances' })
  const verdict = panel({ name: 'creative-director', node: 'decider', text: 'Halo = stances.', emphasis: 'join' })
  const panels = [panel(), gameplay, verdict]
  const note = () => holdNoteContent(input({ panels, thoughts: { gameplay: 'Thought about stances.' } }))

  it('finds nothing edited in a note as it was written', () => {
    expect(proposalEdits(note(), panels)).toEqual({})
  })

  it('reads an edited proposal as its node’s revision, headings in its own text and all', () => {
    const edited = note().replace('Stances mapped to segments.', 'Halo is a burden.')
    expect(proposalEdits(edited, panels)).toEqual({ gameplay: 'Halo is a burden.\n\n## Proposed canon\n- stances' })
  })

  it('leaves the thinking fold out of the revision', () => {
    const edited = note().replace('Stances mapped to segments.', 'Halo is a burden.')
    expect(proposalEdits(edited, panels).gameplay).not.toContain('Thought about stances.')
  })

  it('ignores an edit to the verdict, which is not a proposer', () => {
    expect(proposalEdits(note().replace('Halo = stances.', 'Something else.'), panels)).toEqual({})
  })

  it('ignores a proposal whose heading the human removed', () => {
    expect(proposalEdits(note().replace('### character-director', ''), panels)).toEqual({})
  })
})

describe('editsToCarry', () => {
  const world = panel({ name: 'world-director', node: 'world', text: 'A test chamber.' })
  const gameplay = panel({ name: 'gameplay-director', node: 'gameplay', text: 'Stances.' })
  const verdict = panel({ name: 'creative-director', node: 'decider', text: 'Old verdict.', emphasis: 'join' })
  const before = [world, gameplay, verdict]
  /** The run a rerun of `gameplay: Halo is a burden.` landed on: `world` replayed, the verdict rewritten. */
  const landed = [world, { ...gameplay, text: 'Halo is a burden.' }, { ...verdict, text: 'New verdict.' }]
  const sent = { gameplay: 'Halo is a burden.' }
  const note = () => holdNoteContent(input({ panels: before })).replace('Stances.', 'Halo is a burden.')

  it('carries nothing when nothing was edited while the rerun went', () => {
    expect(editsToCarry(note(), { before, landed, sent })).toEqual({ carried: {}, replaced: [] })
  })

  it('carries a proposal the rerun only replayed, edited while it went, by name', () => {
    const current = note().replace('A test chamber.', 'A theme park.')
    expect(editsToCarry(current, { before, landed, sent })).toEqual({ carried: { 'world-director': 'A theme park.' }, replaced: [] })
  })

  it('refuses when an edit the rerun was sent has changed since', () => {
    expect(editsToCarry(note().replace('Halo is a burden.', 'Halo is a leash.'), { before, landed, sent })).toBeUndefined()
  })

  it('refuses when an edit the rerun was sent has been taken back since', () => {
    expect(editsToCarry(holdNoteContent(input({ panels: before })), { before, landed, sent })).toBeUndefined()
  })

  it('names a proposal edited but not sent that the rerun wrote again, whose new words win', () => {
    const rewrote = [world, { ...gameplay, text: 'Halo is a burden.' }, panel({ name: 'art-director', node: 'art', text: 'New art.' })]
    const artBefore = [...before, panel({ name: 'art-director', node: 'art', text: 'Old art.' })]
    const current = holdNoteContent(input({ panels: artBefore })).replace('Stances.', 'Halo is a burden.').replace('Old art.', 'My art.')
    expect(editsToCarry(current, { before: artBefore, landed: rewrote, sent })).toEqual({ carried: {}, replaced: ['art-director'] })
  })

  it('leaves the proposal a reply revised to the run it landed on', () => {
    const revised = [world, { ...gameplay, text: 'Because.' }, verdict]
    const current = holdNoteContent(input({ panels: before })).replace('Stances.', 'My own words.')
    expect(editsToCarry(current, { before, landed: revised, sent: {}, revised: 'gameplay' })).toEqual({ carried: {}, replaced: [] })
  })

  it('names a proposal edited but not sent that the run it landed on no longer has', () => {
    const current = note().replace('A test chamber.', 'A theme park.')
    expect(editsToCarry(current, { before, landed: landed.slice(1), sent })).toEqual({ carried: {}, replaced: ['world-director'] })
  })
})

describe('refreshHoldNote', () => {
  const verdict = (text: string) => panel({ name: 'creative-director', node: 'decider', text, emphasis: 'join' })
  const first = holdNoteContent(input({ panels: [panel(), verdict('Stance-switching combat.')] })).replace(
    'KEEP:\n',
    'KEEP: fast combat\n',
  )
  const refreshed = () => refreshHoldNote(first, input({ runId: '2026-09-16-Zz1', panels: [panel(), verdict('Halo as burden.')] }))

  it('shows the new run’s verdict under its heading', () => {
    expect(refreshed()).toContain('# Hold: run 2026-09-16-Zz1 · creative-director')
    expect(extractVerdict(refreshed())).toBe('Halo as burden.')
  })

  it('folds the old verdict under Previous verdict, named by the run it came from', () => {
    const content = refreshed()
    const previous = content.slice(content.indexOf('## Previous verdict'), content.indexOf('## Proposals'))
    expect(previous).toContain('<summary>run 2026-09-15-Ab3dE1</summary>')
    expect(previous).toContain('Stance-switching combat.')
  })

  it('keeps the Direction the human wrote', () => {
    expect(refreshed()).toContain('KEEP: fast combat')
  })

  it('stacks every earlier verdict, newest first', () => {
    const again = refreshHoldNote(refreshed(), input({ runId: '2026-09-17-Yy2', panels: [panel(), verdict('Third verdict.')] }))
    expect(again.match(/## Previous verdict/g)).toHaveLength(1)
    expect(again.indexOf('Halo as burden.')).toBeLessThan(again.indexOf('Stance-switching combat.'))
    expect(extractVerdict(again)).toBe('Third verdict.')
  })

  it('still names the run it came from when that run gave no verdict', () => {
    const empty = holdNoteContent(input({ panels: [panel(), verdict('')] }))
    expect(reranFrom(refreshHoldNote(empty, input({ runId: '2026-09-16-Zz1', panels: [panel(), verdict('Halo as burden.')] })))).toEqual([
      '2026-09-15-Ab3dE1',
    ])
  })
})

describe('reranFrom', () => {
  const verdict = (text: string) => panel({ name: 'creative-director', node: 'decider', text, emphasis: 'join' })

  it('names every run a hold was rerun from, newest first', () => {
    const first = holdNoteContent(input({ panels: [panel(), verdict('First.')] }))
    const second = refreshHoldNote(first, input({ runId: '2026-09-16-Zz1', panels: [panel(), verdict('Second.')] }))
    const third = refreshHoldNote(second, input({ runId: '2026-09-17-Yy2', panels: [panel(), verdict('Third.')] }))
    expect(reranFrom(third)).toEqual(['2026-09-16-Zz1', '2026-09-15-Ab3dE1'])
  })

  it('names none for a hold never rerun', () => {
    expect(reranFrom(holdNoteContent(input()))).toEqual([])
  })
})

/** The body under `## Verdict (…)`, up to the next level-two heading. */
function extractVerdict(content: string): string {
  const start = content.indexOf('\n', content.indexOf('## Verdict')) + 1
  return content.slice(start, content.indexOf('\n## ', start)).trim()
}

describe('appendResumeLink', () => {
  it('adds a Resumed heading with the run linked, when there is no such heading yet', () => {
    const content = appendResumeLink('# Hold: run x\n\n## Conversation\n', { runId: '2026-09-15-Ab3dE1', url: 'http://x/history/2026-09-15-Ab3dE1' })
    expect(content).toContain('## Resumed')
    expect(content).toContain('[develop-direction run 2026-09-15-Ab3dE1](http://x/history/2026-09-15-Ab3dE1)')
  })

  it('names the run without a link when the engine URL will not resolve one', () => {
    const content = appendResumeLink('## Conversation\n', { runId: '2026-09-15-Ab3dE1' })
    expect(content).toContain('develop-direction run 2026-09-15-Ab3dE1')
    expect(content).not.toContain('[develop-direction')
  })

  it('adds a second resume under the same heading, rather than a second one', () => {
    const once = appendResumeLink('## Conversation\n', { runId: 'run-1' })
    const twice = appendResumeLink(once, { runId: 'run-2' })
    expect(twice.match(/## Resumed/g)).toHaveLength(1)
    expect(twice).toContain('run-1')
    expect(twice).toContain('run-2')
  })
})
