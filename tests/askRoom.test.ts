import { describe, it, expect } from 'vitest'
import { appendRoomAnswers } from '@/run/askRoom'

/**
 * Ask the room: what an `ask the room: …` line means, and how every
 * proposer's answer lands under it. `holds.test.ts` is the order this
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

  it('keeps a long answer whole, its blank lines and headings included', () => {
    const content = HOLD + 'ask the room: how would you push it?\n'
    const answer = 'Line one.\n\n## Why\nLine two.\nLine three.\nLine four.'
    const appended = appendRoomAnswers(content, 'how would you push it?', [{ name: 'gameplay-director', answer }])
    expect(appended).toContain('> **gameplay-director:**\n> Line one.\n> \n> ## Why\n> Line two.\n> Line three.\n> Line four.\n')
  })

  it('leaves the note as it was when the question is no longer there to answer', () => {
    const content = HOLD + 'ask the room: is this too much Nier?\n'
    const appended = appendRoomAnswers(content, 'a different question', [{ name: 'gameplay-director', answer: 'x' }])
    expect(appended).toBe(content)
  })
})
