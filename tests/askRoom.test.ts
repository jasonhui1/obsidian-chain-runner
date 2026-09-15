import { describe, it, expect } from 'vitest'
import { appendRoomAnswers, pendingRoomQuestion } from '@/run/askRoom'

/**
 * Ask the room: what an `ask the room: …` line means, and how every
 * proposer's answer lands under it. `askTheRoom.test.ts` is the order this
 * happens in.
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

describe('pendingRoomQuestion', () => {
  it('answers undefined when the Conversation section is empty', () => {
    expect(pendingRoomQuestion(HOLD)).toBeUndefined()
  })

  it('reads an `ask the room: …` line with no answers yet', () => {
    const content = HOLD + 'ask the room: is this too much Nier?\n'
    expect(pendingRoomQuestion(content)).toBe('is this too much Nier?')
  })

  it('answers undefined once the question already carries answers', () => {
    const content = HOLD + 'ask the room: is this too much Nier?\n> **gameplay-director:**\n> a bit.\n'
    expect(pendingRoomQuestion(content)).toBeUndefined()
  })

  it('reads only the most recent unanswered question', () => {
    const content = HOLD + 'ask the room: first?\n> **gameplay-director:**\n> yes.\nask the room: second?\n'
    expect(pendingRoomQuestion(content)).toBe('second?')
  })

  it('is case-insensitive', () => {
    const content = HOLD + 'Ask The Room: is this too much Nier?\n'
    expect(pendingRoomQuestion(content)).toBe('is this too much Nier?')
  })

  it('does not mistake a `@name` chat line for a room question', () => {
    const content = HOLD + '@gameplay-director defend it.\n'
    expect(pendingRoomQuestion(content)).toBeUndefined()
  })
})

describe('appendRoomAnswers', () => {
  it('appends every answer labeled by proposer, under the question', () => {
    const content = HOLD + 'ask the room: is this too much Nier?\n'
    const appended = appendRoomAnswers(content, 'is this too much Nier?', [
      { name: 'gameplay-director', answer: 'A bit, but the cost sells it.' },
      { name: 'character-director', answer: 'No, the silhouette carries it.' },
    ])
    expect(appended).toBe(
      content +
        '> **gameplay-director:**\n> A bit, but the cost sells it.\n> **character-director:**\n> No, the silhouette carries it.\n',
    )
  })

  it('folds a multi-line answer to at most three non-blank lines', () => {
    const content = HOLD + 'ask the room: how would you push it?\n'
    const answer = 'Line one.\n\nLine two.\nLine three.\nLine four.'
    const appended = appendRoomAnswers(content, 'how would you push it?', [{ name: 'gameplay-director', answer }])
    expect(appended).toContain('> **gameplay-director:**\n> Line one.\n> Line two.\n> Line three.\n')
    expect(appended).not.toContain('Line four.')
  })

  it('leaves the note as it was when the question is no longer there to answer', () => {
    const content = HOLD + 'ask the room: is this too much Nier?\n'
    const appended = appendRoomAnswers(content, 'a different question', [{ name: 'gameplay-director', answer: 'x' }])
    expect(appended).toBe(content)
  })
})
