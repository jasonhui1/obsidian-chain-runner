import { describe, it, expect } from 'vitest'
import { appendSideQuestResult, pendingSideQuest } from '@/run/sideQuest'

/**
 * Side quest: what a `side quest: @name chain` line means, and how a run's
 * result lands under it. `sideQuestCommand.test.ts` is the order this happens
 * in.
 */

const HOLD = [
  '# Hold: run 2026-09-15-Ab3dE1 · creative-director',
  '',
  '## Proposals',
  '### gameplay-director',
  '',
  'Stances mapped to segments.',
  '',
  '## Direction',
  'KEEP:',
  '',
  '## Conversation',
  '',
].join('\n')

describe('pendingSideQuest', () => {
  it('answers undefined when the Conversation section is empty', () => {
    expect(pendingSideQuest(HOLD)).toBeUndefined()
  })

  it('reads a `side quest: @name chain` line with no result yet', () => {
    const content = HOLD + 'side quest: @gameplay-director combat-lab\n'
    expect(pendingSideQuest(content)).toEqual({ name: 'gameplay-director', chainName: 'combat-lab' })
  })

  it('answers undefined once the line already carries a result', () => {
    const content = HOLD + 'side quest: @gameplay-director combat-lab\n> → run 2026-09-16-Xy9zW2\n> Stances land as a rhythm system.\n'
    expect(pendingSideQuest(content)).toBeUndefined()
  })

  it('reads only the most recent unresolved side quest', () => {
    const content =
      HOLD + 'side quest: @gameplay-director combat-lab\n> → run 2026-09-16-Xy9zW2\n> ok.\nside quest: @character-director combat-lab\n'
    expect(pendingSideQuest(content)).toEqual({ name: 'character-director', chainName: 'combat-lab' })
  })

  it('reads a chain whose name has spaces in it whole', () => {
    const content = HOLD + 'side quest: @gameplay-director combat lab \n'
    expect(pendingSideQuest(content)).toEqual({ name: 'gameplay-director', chainName: 'combat lab' })
  })

  it('does not mistake a `@name` chat line for a side quest', () => {
    const content = HOLD + '@gameplay-director defend it.\n'
    expect(pendingSideQuest(content)).toBeUndefined()
  })
})

describe('appendSideQuestResult', () => {
  it('appends the run link and result under the trigger line', () => {
    const content = HOLD + 'side quest: @gameplay-director combat-lab\n'
    const appended = appendSideQuestResult(
      content,
      { name: 'gameplay-director', chainName: 'combat-lab' },
      { runId: '2026-09-16-Xy9zW2', url: 'http://localhost:4000/history/2026-09-16-Xy9zW2', result: 'Stances land as a rhythm system.' },
    )
    expect(appended).toBe(
      content + '> → [run 2026-09-16-Xy9zW2](http://localhost:4000/history/2026-09-16-Xy9zW2)\n> Stances land as a rhythm system.\n',
    )
  })

  it('falls back to a plain run reference with no url', () => {
    const content = HOLD + 'side quest: @gameplay-director combat-lab\n'
    const appended = appendSideQuestResult(content, { name: 'gameplay-director', chainName: 'combat-lab' }, { runId: '2026-09-16-Xy9zW2', result: 'ok.' })
    expect(appended).toContain('> → run 2026-09-16-Xy9zW2\n> ok.\n')
  })

  it('leaves the note as it was when the trigger is no longer there', () => {
    const content = HOLD + 'side quest: @gameplay-director combat-lab\n'
    const appended = appendSideQuestResult(content, { name: 'character-director', chainName: 'combat-lab' }, { runId: 'x', result: 'ok.' })
    expect(appended).toBe(content)
  })
})
