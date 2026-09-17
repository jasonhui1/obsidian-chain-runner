import { describe, it, expect } from 'vitest'
import { chatReply, repliesSoFar } from '@/run/proposerChat'
import { EngineHttpError, EngineOfflineError } from '@/engine/transport'
import type { EngineClient } from '@/engine/client'
import type { AgentOutput, Capabilities, ChatEvent } from '@/engine/types'

/**
 * The real chat with a proposer, apart from the note: what the stream's events
 * mean, what each refusal reads as, and where the approximate chat takes over.
 */

const CHAT = { runId: '2026-09-15-Ab3dE1', nodeId: 'gameplay-director', name: 'gameplay-director', message: 'defend the sleeves' }

/** An engine whose chat stream yields `events`, or throws `fails` before it starts. */
function engineOf(events: ChatEvent[], fails?: unknown): EngineClient {
  return {
    chatWithNode: async function* () {
      if (fails) throw fails
      for (const event of events) yield event
    },
  } as unknown as EngineClient
}

const HAS_CHAT: Capabilities = { proposerChat: true }

/** What the module says about an engine that answered `status`. */
async function refused(status: number, body = ''): Promise<string | undefined> {
  const outcome = await chatReply(engineOf([], new EngineHttpError(status, 'http://engine/chat', body)), HAS_CHAT, CHAT)
  return outcome.kind === 'refused' ? outcome.said : undefined
}

describe('chatReply', () => {
  it('answers with the reply the chat stream finished on', async () => {
    const outcome = await chatReply(
      engineOf([
        { type: 'token', token: 'fair ' },
        { type: 'token', token: 'point' },
        { type: 'chat_done', message: { role: 'assistant', content: 'fair point', thought: 'weighed it' } },
      ]),
      HAS_CHAT,
      CHAT,
    )
    expect(outcome).toEqual({ kind: 'reply', text: 'fair point' })
  })

  it('answers with what the engine said when the model failed', async () => {
    const outcome = await chatReply(engineOf([{ type: 'error', error: 'the model refused' }]), HAS_CHAT, CHAT)
    expect(outcome).toEqual({ kind: 'refused', said: 'Chat with gameplay-director failed: the model refused' })
  })

  it('says the run is still going on a 409', async () => {
    expect(await refused(409)).toBe('Run 2026-09-15-Ab3dE1 is still running — chat with gameplay-director once it stops')
  })

  it('says the node is gone on a 404, when the engine claims the endpoint', async () => {
    expect(await refused(404)).toBe('Run 2026-09-15-Ab3dE1 no longer has a node for gameplay-director')
  })

  it('passes on what the engine refused a 400 with', async () => {
    expect(await refused(400, '{"error":"node is not a proposer"}')).toBe('gameplay-director cannot be chatted with: node is not a proposer')
  })

  it('reads a plain-text 400 body just as well', async () => {
    expect(await refused(400, 'node has no log')).toBe('gameplay-director cannot be chatted with: node has no log')
  })

  it('says the agent file is gone on a 422', async () => {
    expect(await refused(422)).toBe("gameplay-director's agent file is gone from the workspace")
  })

  it('still names an engine error it has no words of its own for', async () => {
    expect(await refused(500, 'boom')).toBe('Engine error 500: boom')
  })

  it('leaves an unreachable engine to the caller guard', async () => {
    await expect(chatReply(engineOf([], new EngineOfflineError('http://engine/chat')), HAS_CHAT, CHAT)).rejects.toBeInstanceOf(EngineOfflineError)
  })
})

describe('the boundary with approximate chat', () => {
  it('sends nothing when the engine says it has no chat endpoint', async () => {
    let called = false
    const engine = {
      chatWithNode: () => {
        called = true
        return engineOf([]).chatWithNode(CHAT)
      },
    } as unknown as EngineClient
    expect(await chatReply(engine, { proposerChat: false }, CHAT)).toEqual({ kind: 'unsupported' })
    expect(called).toBe(false)
  })

  it('reads a 404 from an engine too old to claim the endpoint as the route missing', async () => {
    const outcome = await chatReply(engineOf([], new EngineHttpError(404, 'http://engine/chat', 'Not found')), {}, CHAT)
    expect(outcome).toEqual({ kind: 'unsupported' })
  })

  it('calls an engine that says nothing either way, since that is the only way to find out', async () => {
    const outcome = await chatReply(engineOf([{ type: 'chat_done', message: { role: 'assistant', content: 'fair point' } }]), {}, CHAT)
    expect(outcome).toEqual({ kind: 'reply', text: 'fair point' })
  })
})

const output = (nodeId: string, conversation?: AgentOutput['conversation']): AgentOutput => ({
  nodeId,
  agentName: nodeId,
  output: 'x',
  status: 'success',
  timestamp: '',
  ...(conversation ? { conversation } : {}),
})

describe('repliesSoFar', () => {
  it('counts the node assistant replies, so the next one knows its turn', () => {
    const outputs = [
      output('gameplay-director', [
        { role: 'user', content: 'defend the sleeves' },
        { role: 'assistant', content: 'fair point' },
        { role: 'user', content: 'again' },
        { role: 'assistant', content: 'still fair' },
      ]),
    ]
    expect(repliesSoFar(outputs, 'gameplay-director')).toBe(2)
  })

  it('is zero for a node that has never been chatted with', () => {
    expect(repliesSoFar([output('gameplay-director')], 'gameplay-director')).toBe(0)
  })

  it('reads the last output of the node, the way the engine resolves one', () => {
    const outputs = [
      output('gameplay-director', [{ role: 'assistant', content: 'old' }]),
      output('gameplay-director', [
        { role: 'assistant', content: 'old' },
        { role: 'assistant', content: 'new' },
      ]),
    ]
    expect(repliesSoFar(outputs, 'gameplay-director')).toBe(2)
  })
})
