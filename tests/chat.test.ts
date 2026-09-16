import { describe, it, expect } from 'vitest'
import { appendChatReply, chatSeed, markRevised, pendingMessage, pendingRevise } from '@/run/chat'
import type { AgentOutput, RunGraph, RunMeta } from '@/engine/types'

/**
 * Approximate chat with a proposer, apart from the vault and the engine: what a
 * `@name message` line means, what a bare `revise` refers to, and the seed a
 * standalone agent call is given. `chatWithProposer.test.ts` is the order this
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

describe('pendingMessage', () => {
  it('answers undefined when the Conversation section is empty', () => {
    expect(pendingMessage(HOLD)).toBeUndefined()
  })

  it('reads an `@name message` line with no reply yet', () => {
    const content = HOLD + '@gameplay-director this is Nier again. defend or change.\n'
    expect(pendingMessage(content)).toEqual({ name: 'gameplay-director', message: 'this is Nier again. defend or change.' })
  })

  it('answers undefined once the line already carries a reply', () => {
    const content = HOLD + '@gameplay-director defend it.\n> Halo is a burden, not a toolkit.\n'
    expect(pendingMessage(content)).toBeUndefined()
  })

  it('reads only the most recent unanswered message', () => {
    const content = HOLD + '@gameplay-director first.\n> replied.\n@gameplay-director second.\n'
    expect(pendingMessage(content)?.message).toBe('second.')
  })
})

describe('pendingRevise', () => {
  it('answers undefined when Conversation does not end in a bare `revise`', () => {
    const content = HOLD + '@gameplay-director defend it.\n> Halo is a burden.\n'
    expect(pendingRevise(content)).toBeUndefined()
  })

  it('reads the turn a trailing `revise` refers to', () => {
    const content = HOLD + '@gameplay-director defend it.\n> Halo is a burden.\nrevise\n'
    expect(pendingRevise(content)).toEqual({ name: 'gameplay-director', message: 'defend it.', reply: 'Halo is a burden.' })
  })

  it('is case-insensitive', () => {
    const content = HOLD + '@gameplay-director defend it.\n> Halo is a burden.\nRevise\n'
    expect(pendingRevise(content)?.name).toBe('gameplay-director')
  })

  it('answers undefined when the last message has no reply to revise', () => {
    const content = HOLD + '@gameplay-director defend it.\nrevise\n'
    expect(pendingRevise(content)).toBeUndefined()
  })
})

describe('appendChatReply', () => {
  it('inserts the reply as a blockquote right under the message', () => {
    const content = HOLD + '@gameplay-director defend it.\n'
    const appended = appendChatReply(content, { name: 'gameplay-director', message: 'defend it.' }, 'Halo is a burden.')
    expect(appended).toBe(HOLD + '@gameplay-director defend it.\n> Halo is a burden.\n')
  })

  it('quotes every line of a multi-line reply', () => {
    const content = HOLD + '@gameplay-director defend it.\n'
    const appended = appendChatReply(content, { name: 'gameplay-director', message: 'defend it.' }, 'Line one.\nLine two.')
    expect(appended).toContain('> Line one.\n> Line two.\n')
  })

  it('leaves the note as it was when the turn is no longer there to reply to', () => {
    const content = HOLD + '@gameplay-director defend it.\n'
    expect(appendChatReply(content, { name: 'gameplay-director', message: 'a different message' }, 'reply')).toBe(content)
  })
})

describe('markRevised', () => {
  it('replaces the trailing bare `revise` with which run it produced', () => {
    const content = HOLD + '@gameplay-director defend it.\n> Halo is a burden.\nrevise\n'
    expect(markRevised(content, '2026-09-16-Xy9zW2')).toContain('revise → reran as run 2026-09-16-Xy9zW2')
    expect(markRevised(content, '2026-09-16-Xy9zW2')).not.toMatch(/revise\s*$/)
  })
})

const graph: RunGraph = {
  edges: [
    { fromNode: 'creative-brief', toNode: 'gameplay-director' },
    { fromNode: 'seed', toNode: 'gameplay-director' },
  ],
}

const output = (nodeId: string, text: string): AgentOutput => ({ nodeId, agentName: nodeId, output: text, status: 'success', timestamp: '' })

const run = (over: Partial<RunMeta> = {}): RunMeta => ({
  runId: '2026-09-15-Ab3dE1',
  chainName: 'creative-director',
  seedPrompt: 'a halo',
  startedAt: '',
  status: 'complete',
  agentOutputs: [output('creative-brief', 'The brief.'), output('gameplay-director', 'Stances mapped to segments.')],
  graph,
  ...over,
})

describe('chatSeed', () => {
  it('joins the node’s previous inputs, its previous output, and the new message', () => {
    const seed = chatSeed(run(), 'gameplay-director', 'defend the sleeves')
    expect(seed).toBe('The brief.\n\nStances mapped to segments.\n\ndefend the sleeves')
  })

  it('answers undefined for a run with no graph', () => {
    expect(chatSeed(run({ graph: undefined }), 'gameplay-director', 'x')).toBeUndefined()
  })

  it('answers undefined for a node the run never produced an output for', () => {
    expect(chatSeed(run(), 'nonexistent', 'x')).toBeUndefined()
  })

  it('skips a predecessor the run has no stored output for, such as a seed or context node', () => {
    const seed = chatSeed(run({ agentOutputs: [output('gameplay-director', 'Stances mapped to segments.')] }), 'gameplay-director', 'x')
    expect(seed).toBe('Stances mapped to segments.\n\nx')
  })
})
