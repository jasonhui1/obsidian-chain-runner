import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EngineClient } from '@/engine/client'
import { createNodeTransport } from '@/engine/nodeTransport'
import { EngineHttpError, EngineOfflineError } from '@/engine/transport'
import type { ChatEvent, PromoteRequest, ResumeRequest, RunEvent, VarianceRunEvent } from '@/engine/types'
import { FakeEngine, frame } from './fakeEngine'

let engine: FakeEngine
let client: EngineClient

beforeEach(async () => {
  engine = await FakeEngine.start()
  client = new EngineClient(() => engine.url, createNodeTransport())
})

afterEach(async () => {
  await engine.stop()
})

async function drain(source: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const events: RunEvent[] = []
  for await (const event of source) events.push(event)
  return events
}

async function drainChat(source: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = []
  for await (const event of source) events.push(event)
  return events
}

async function drainVariance(source: AsyncIterable<VarianceRunEvent>): Promise<VarianceRunEvent[]> {
  const events: VarianceRunEvent[] = []
  for await (const event of source) events.push(event)
  return events
}

/** A client pointed at a port with nothing behind it. */
async function offlineClient(): Promise<EngineClient> {
  const dead = await FakeEngine.start()
  const url = dead.url
  await dead.stop()
  return new EngineClient(() => url, createNodeTransport())
}

describe('listChains', () => {
  it('drops a view it cannot draw, which is the same to it as none at all', async () => {
    engine.chains = [{ slug: 'x', name: 'X', view: 'kanban', outputs: [{ name: 'a', node: 'a' }] }]
    expect((await client.listChains())[0].view).toBeUndefined()
  })

  it('returns each chain narrowed to what the picker shows', async () => {
    engine.chains = [
      {
        slug: 'five-personas',
        name: 'Five Personas',
        description: 'the mechanism, in the chain own words',
        moment: 'when a premise feels safe',
        purpose: 'insight',
        parameter: { name: 'audience', options: ['engineers', 'execs'], node: 'param' },
        view: 'timeline',
        outputs: [{ name: 'skeleton', node: 'third', socket: 'summary', role: 'join' }],
        nodes: [{ id: 'seed', kind: 'seed' }, { id: 'third', kind: 'agent' }],
        edges: [],
      },
      { slug: 'bare', name: 'Bare', description: '', nodes: [{ id: 'pinned', kind: 'context' }], edges: [] },
    ]
    expect(await client.listChains()).toEqual([
      {
        slug: 'five-personas',
        name: 'Five Personas',
        description: 'the mechanism, in the chain own words',
        moment: 'when a premise feels safe',
        purpose: 'insight',
        parameter: { name: 'audience', options: ['engineers', 'execs'] },
        view: 'timeline',
        outputs: [{ name: 'skeleton', node: 'third', socket: 'summary', role: 'join' }],
        seeded: true,
      },
      { slug: 'bare', name: 'Bare', seeded: false },
    ])
  })

  it('throws EngineOfflineError when the engine is not running', async () => {
    const client = await offlineClient()
    await expect(client.listChains()).rejects.toBeInstanceOf(EngineOfflineError)
  })

  it('throws EngineHttpError when the engine answers with a failure', async () => {
    engine.failWith = { status: 500, body: 'workspace unreadable' }
    await expect(client.listChains()).rejects.toBeInstanceOf(EngineHttpError)
  })
})

describe('loadWorkspace capabilities', () => {
  it('reports what the engine says it can do', async () => {
    expect((await client.loadWorkspace()).capabilities).toEqual({ runLayoutFrames: true })
  })

  it('reads an engine too old to say anything as supporting nothing', async () => {
    engine.capabilities = undefined
    expect((await client.loadWorkspace()).capabilities).toEqual({})
  })

  it('does not invent support the engine did not claim', async () => {
    engine.capabilities = {}
    expect((await client.loadWorkspace()).capabilities.runLayoutFrames).toBeUndefined()
  })
})

describe('capabilities', () => {
  const workspaceLoads = (): number => engine.requests.filter(request => request.path === '/api/workspace').length

  it('asks the engine once and keeps what it said', async () => {
    expect(await client.capabilities()).toEqual({ runLayoutFrames: true })
    engine.capabilities = { runLayoutFrames: false }
    expect(await client.capabilities()).toEqual({ runLayoutFrames: true })
    expect(workspaceLoads()).toBe(1)
  })

  it('keeps what a workspace load already said, without asking again', async () => {
    await client.listChains()
    await client.capabilities()
    expect(workspaceLoads()).toBe(1)
  })

  it('shares one question among callers asking at once', async () => {
    await Promise.all([client.capabilities(), client.capabilities()])
    expect(workspaceLoads()).toBe(1)
  })

  it('takes what a later workspace load says — the status poll’s refresh', async () => {
    await client.capabilities()
    engine.capabilities = { runLayoutFrames: true, runResume: true }
    await client.loadWorkspace()
    expect(await client.capabilities()).toEqual({ runLayoutFrames: true, runResume: true })
  })

  it('asks again once the base URL names another engine', async () => {
    let url = engine.url
    const moving = new EngineClient(() => url, createNodeTransport())
    await moving.capabilities()
    const other = await FakeEngine.start()
    try {
      other.capabilities = { nodePromote: true }
      url = other.url
      expect(await moving.capabilities()).toEqual({ nodePromote: true })
    } finally {
      await other.stop()
    }
  })

  it('keeps nothing from a failed question, so the next one asks again', async () => {
    engine.failWith = { status: 500, body: 'workspace unreadable' }
    await expect(client.capabilities()).rejects.toBeInstanceOf(EngineHttpError)
    engine.failWith = undefined
    expect(await client.capabilities()).toEqual({ runLayoutFrames: true })
  })
})

describe('getRun', () => {
  it('returns the run meta', async () => {
    engine.runMeta = { runId: '2026-09-02-ab12c', chainName: 'Five Personas', status: 'complete', agentOutputs: [] }
    const meta = await client.getRun('2026-09-02-ab12c')
    expect(meta.runId).toBe('2026-09-02-ab12c')
    expect(engine.requests.at(-1)?.path).toBe('/api/runs/2026-09-02-ab12c')
  })

  it('escapes a run id so it cannot reach another route', async () => {
    engine.runMeta = { runId: 'x', chainName: 'c', status: 'complete', agentOutputs: [] }
    await client.getRun('a/../b')
    expect(engine.requests.at(-1)?.path).toBe('/api/runs/a%2F..%2Fb')
  })

  it('throws EngineOfflineError when the engine is not running', async () => {
    const client = await offlineClient()
    await expect(client.getRun('any')).rejects.toBeInstanceOf(EngineOfflineError)
  })
})

describe('waitingRun', () => {
  const hold = { nodeId: 'pick', input: '', candidates: [], reachedAt: 'now' }

  it('asks the engine for the runs waiting on a human, and answers the one named', async () => {
    engine.runs = [
      { runId: 'other', chainName: 'c', status: 'waiting', agentOutputs: [], holds: [hold] },
      { runId: 'r1', chainName: 'c', status: 'waiting', agentOutputs: [], holds: [hold] },
    ]
    const run = await client.waitingRun('r1')
    expect(run?.holds).toEqual([hold])
    expect(engine.requests.at(-1)?.path).toBe('/api/runs?status=waiting')
  })

  it('answers nothing for a run that is not waiting', async () => {
    engine.runs = [{ runId: 'other', chainName: 'c', status: 'waiting', agentOutputs: [] }]
    expect(await client.waitingRun('r1')).toBeUndefined()
  })

  it('throws EngineOfflineError when the engine is not running', async () => {
    const client = await offlineClient()
    await expect(client.waitingRun('r1')).rejects.toBeInstanceOf(EngineOfflineError)
  })
})

describe('hold feedback and reroll', () => {
  it('saves empty feedback with PATCH and decodes the returned hold', async () => {
    engine.holdFeedback = { hold: { nodeId: 'pick', input: 'old', candidates: [], reachedAt: 'now', revision: 2, feedback: '' } }
    const hold = await client.updateHoldFeedback('run/1', 'pick/one', '')
    expect(hold).toMatchObject({ nodeId: 'pick', revision: 2, feedback: '' })
    expect(engine.requests.at(-1)).toMatchObject({
      method: 'PATCH',
      path: '/api/runs/run%2F1/holds/pick%2Fone',
      body: '{"feedback":""}',
    })
  })

  it('posts the current revision to the hold reroll stream', async () => {
    engine.runFrames = [frame({ type: 'run_start', runId: 'r1' }), frame({ type: 'run_waiting', runId: 'r1', nodeId: 'pick', hold: { nodeId: 'pick', input: '', candidates: [], reachedAt: 'now', revision: 3 } })]
    const events = await drain(client.rerollHold('r1', 'pick', 3))
    expect(events.at(-1)?.type).toBe('run_waiting')
    expect(engine.requests.at(-1)).toMatchObject({
      method: 'POST',
      path: '/api/runs/r1/holds/pick/reroll',
      body: '{"revision":3}',
    })
  })
})

describe('runExists', () => {
  it('finds a run the engine still holds', async () => {
    engine.runMeta = { runId: 'r1', chainName: 'c', status: 'complete', agentOutputs: [] }
    expect(await client.runExists('r1')).toBe('found')
  })

  it('reports a run the engine says it has no record of', async () => {
    engine.failWith = { status: 404, body: 'Run not found' }
    expect(await client.runExists('r1')).toBe('missing')
  })

  it('answers rather than throwing when the engine cannot be reached', async () => {
    const client = await offlineClient()
    expect(await client.runExists('r1')).toBe('unknown')
  })

  it('does not read another failure as a deletion', async () => {
    engine.failWith = { status: 500, body: 'broken' }
    expect(await client.runExists('r1')).toBe('unknown')
  })
})

describe('getLayout', () => {
  it('returns the layout model', async () => {
    engine.layout = { kind: 'columns', panels: [{ name: 'optimist', text: 'hi', lines: 1, state: 'filled' }] }
    expect(await client.getLayout('2026-09-02-ab12c')).toEqual(engine.layout)
    expect(engine.requests.at(-1)?.path).toBe('/api/runs/2026-09-02-ab12c/layout')
  })

  it('throws EngineOfflineError when the engine is not running', async () => {
    const client = await offlineClient()
    await expect(client.getLayout('any')).rejects.toBeInstanceOf(EngineOfflineError)
  })
})

describe('launchRun', () => {
  it('posts the chain, seed, and parameter pick', async () => {
    engine.runFrames = [frame({ type: 'run_complete', runId: 'r1' })]
    await drain(client.launchRun({ chainName: 'Five Personas', seedPrompt: 'a premise', paramValue: 'engineers' }))
    const sent = engine.requests.at(-1)!
    expect(sent.method).toBe('POST')
    expect(sent.path).toBe('/api/run')
    expect(JSON.parse(sent.body)).toEqual({
      chainName: 'Five Personas',
      seedPrompt: 'a premise',
      paramValue: 'engineers',
    })
  })

  it('yields every event type the run API emits, in order', async () => {
    const output = {
      nodeId: 'optimist',
      agentName: 'Optimist',
      output: 'looks good',
      status: 'success',
      timestamp: '2026-09-02T00:00:00.000Z',
    }
    engine.runFrames = [
      frame({ type: 'agent_start', agentName: 'Optimist', nodeId: 'optimist', step: 0, kind: 'agent' }),
      frame({ type: 'token', agentName: 'Optimist', nodeId: 'optimist', token: 'looks ', step: 0 }),
      frame({ type: 'token', agentName: 'Optimist', nodeId: 'optimist', token: 'good', step: 0 }),
      frame({ type: 'agent_done', agentName: 'Optimist', nodeId: 'optimist', step: 0, output }),
      frame({ type: 'run_complete', runId: '2026-09-02-ab12c' }),
    ]
    const events = await drain(client.launchRun({ chainName: 'Five Personas', seedPrompt: 'a premise' }))
    expect(events.map(e => e.type)).toEqual(['agent_start', 'token', 'token', 'agent_done', 'run_complete'])
    expect(events[3]).toMatchObject({ type: 'agent_done', output })
    expect(events[4]).toEqual({ type: 'run_complete', runId: '2026-09-02-ab12c' })
  })

  it('yields the engine error event rather than throwing', async () => {
    engine.runFrames = [frame({ type: 'error', error: 'ANTHROPIC_API_KEY missing' })]
    expect(await drain(client.launchRun({ chainName: 'c', seedPrompt: 's' }))).toEqual([
      { type: 'error', error: 'ANTHROPIC_API_KEY missing' },
    ])
  })

  it('passes through events this ticket does not model', async () => {
    engine.runFrames = [
      frame({ type: 'section_missing', nodeId: 'skeptic', warning: { fromNode: 'skeptic', socket: 'risks' } }),
      frame({ type: 'run_complete', runId: 'r1' }),
    ]
    const events = await drain(client.launchRun({ chainName: 'c', seedPrompt: 's' }))
    expect(events[0]).toMatchObject({ type: 'section_missing', nodeId: 'skeptic' })
  })

  it('reassembles events split across socket writes', async () => {
    engine.runFrames = ['data: {"type":"tok', 'en","nodeId":"a","token":"hi"}\n\n']
    expect(await drain(client.launchRun({ chainName: 'c', seedPrompt: 's' }))).toEqual([
      { type: 'token', nodeId: 'a', token: 'hi' },
    ])
  })

  it('throws EngineOfflineError when the engine is not running', async () => {
    const client = await offlineClient()
    await expect(drain(client.launchRun({ chainName: 'c', seedPrompt: 's' }))).rejects.toBeInstanceOf(
      EngineOfflineError,
    )
  })

  it('throws EngineHttpError when the engine rejects the chain', async () => {
    engine.failWith = { status: 404, body: 'Chain not found' }
    await expect(drain(client.launchRun({ chainName: 'nope', seedPrompt: 's' }))).rejects.toBeInstanceOf(
      EngineHttpError,
    )
  })

  it('stops yielding once the caller aborts', async () => {
    engine.runFrames = [frame({ type: 'agent_start', agentName: 'A', nodeId: 'a', step: 0 })]
    const controller = new AbortController()
    const events: RunEvent[] = []
    await expect(
      (async () => {
        for await (const event of client.launchRun({ chainName: 'c', seedPrompt: 's' }, controller.signal)) {
          events.push(event)
          controller.abort()
        }
      })(),
    ).rejects.toThrow()
    expect(events).toHaveLength(1)
  })
})

describe('launchVariance', () => {
  it('posts one request and keeps interleaved member events and the group completion frame', async () => {
    engine.varianceFrames = [
      frame({ type: 'run_start', runId: 'r0', instance: 0 }),
      frame({ type: 'run_start', runId: 'r1', instance: 1 }),
      frame({ type: 'token', nodeId: 'writer', token: 'first', instance: 0 }),
      frame({ type: 'token', nodeId: 'writer', token: 'second', instance: 1 }),
      frame({ type: 'variance_complete', groupId: 'group-1', runIds: ['r0', 'r1'] }),
    ]

    const events = await drainVariance(client.launchVariance({ chainName: 'c', seedPrompt: 's', paramValue: 'p', count: 2 }))

    expect(events).toEqual([
      { type: 'run_start', runId: 'r0', instance: 0 },
      { type: 'run_start', runId: 'r1', instance: 1 },
      { type: 'token', nodeId: 'writer', token: 'first', instance: 0 },
      { type: 'token', nodeId: 'writer', token: 'second', instance: 1 },
      { type: 'variance_complete', groupId: 'group-1', runIds: ['r0', 'r1'] },
    ])
    expect(engine.requests.at(-1)).toMatchObject({
      method: 'POST',
      path: '/api/variance',
      body: JSON.stringify({ chainName: 'c', seedPrompt: 's', paramValue: 'p', count: 2 }),
    })
  })
})

describe('getVarianceGroup', () => {
  it('reads the engine summary from the encoded group route', async () => {
    engine.varianceGroup = { groupId: 'g/1', expectedRunCount: 2, completedRunCount: 1, runs: [], nodes: [] }

    expect(await client.getVarianceGroup('g/1')).toEqual(engine.varianceGroup)
    expect(engine.requests.at(-1)?.path).toBe('/api/variance/g%2F1')
  })
})

describe('forkRun', () => {
  it('posts revisions and context to the encoded run fork route', async () => {
    engine.runFrames = [frame({ type: 'run_start', runId: 'forked' })]
    const events = await drain(client.forkRun('source/1', {
      revisions: { gameplay: '## Pitch\nNew idea.' },
      context: { 'canon-anime-game': 'Current canon' },
      versions: 'pinned',
    }))
    expect(events).toEqual([{ type: 'run_start', runId: 'forked' }])
    expect(engine.requests.at(-1)).toEqual({
      method: 'POST',
      path: '/api/runs/source%2F1/fork',
      body: JSON.stringify({ revisions: { gameplay: '## Pitch\nNew idea.' }, context: { 'canon-anime-game': 'Current canon' }, versions: 'pinned' }),
    })
  })
})

describe('resumeRun', () => {
  const resume = (request: ResumeRequest = { direction: 'KEEP: fast combat' }) => client.resumeRun('2026-09-15-Ab3dE1', request)

  it('posts the answer to the run resume route', async () => {
    engine.runFrames = [frame({ type: 'run_complete', runId: '2026-09-15-Ab3dE1' })]
    await drain(resume({ direction: 'KEEP: fast combat', chosen: 'Candidate 2', holdId: 'decider' }))
    const sent = engine.requests.at(-1)!
    expect(sent.method).toBe('POST')
    expect(sent.path).toBe('/api/runs/2026-09-15-Ab3dE1/resume')
    expect(JSON.parse(sent.body)).toEqual({ direction: 'KEEP: fast combat', chosen: 'Candidate 2', holdId: 'decider' })
  })

  it('yields the run event set, not the chat stream', async () => {
    engine.runFrames = [
      frame({ type: 'run_start', runId: '2026-09-15-Ab3dE1' }),
      frame({ type: 'agent_start', agentName: 'greenlighter', nodeId: 'greenlighter', step: 0 }),
      frame({ type: 'run_complete', runId: '2026-09-15-Ab3dE1' }),
    ]
    expect((await drain(resume())).map(event => event.type)).toEqual(['run_start', 'agent_start', 'run_complete'])
  })

  it('names the forked run in run_start, which is not the run it was posted to', async () => {
    engine.runFrames = [frame({ type: 'run_start', runId: '2026-09-20-Forked' })]
    expect(await drain(resume())).toEqual([{ type: 'run_start', runId: '2026-09-20-Forked' }])
  })

  it('yields the engine error event rather than throwing', async () => {
    engine.runFrames = [frame({ type: 'error', error: 'the model refused' })]
    expect(await drain(resume())).toEqual([{ type: 'error', error: 'the model refused' }])
  })

  it('throws EngineHttpError carrying the refusal, so the caller can say which one it was', async () => {
    engine.failWith = { status: 409, body: 'run is running' }
    const error = await drain(resume()).catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(EngineHttpError)
    expect((error as EngineHttpError).status).toBe(409)
  })

  it('throws EngineOfflineError when the engine is not running', async () => {
    const client = await offlineClient()
    await expect(drain(client.resumeRun('r1', { direction: 'KEEP: x' }))).rejects.toBeInstanceOf(EngineOfflineError)
  })
})

describe('promoteNode', () => {
  const node = { runId: '2026-09-15-Ab3dE1', nodeId: 'gameplay-director' }
  const promote = (request: PromoteRequest = {}) => client.promoteNode(node, request)

  it('posts the turn to the node promote route', async () => {
    engine.runFrames = [frame({ type: 'run_complete', runId: '2026-09-15-Ab3dE1' })]
    await drain(promote({ turn: 2 }))
    const sent = engine.requests.at(-1)!
    expect(sent.method).toBe('POST')
    expect(sent.path).toBe('/api/runs/2026-09-15-Ab3dE1/nodes/gameplay-director/promote')
    expect(JSON.parse(sent.body)).toEqual({ turn: 2 })
  })

  it('yields the run event set, not the chat stream', async () => {
    engine.runFrames = [
      frame({ type: 'run_start', runId: '2026-09-15-Ab3dE1' }),
      frame({ type: 'agent_start', agentName: 'creative-director', nodeId: 'creative-director', step: 0 }),
      frame({ type: 'run_complete', runId: '2026-09-15-Ab3dE1' }),
    ]
    expect((await drain(promote())).map(event => event.type)).toEqual(['run_start', 'agent_start', 'run_complete'])
  })

  it('names the forked run in run_start, which is not the run it was posted to', async () => {
    engine.runFrames = [frame({ type: 'run_start', runId: '2026-09-20-Forked' })]
    expect(await drain(promote())).toEqual([{ type: 'run_start', runId: '2026-09-20-Forked' }])
  })

  it('throws EngineHttpError carrying the refusal, so the caller can say which one it was', async () => {
    engine.failWith = { status: 400, body: '{"error":"node is inside a loop"}' }
    const error = await drain(promote()).catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(EngineHttpError)
    expect((error as EngineHttpError).status).toBe(400)
  })

  it('throws EngineOfflineError when the engine is not running', async () => {
    const client = await offlineClient()
    await expect(drain(client.promoteNode({ runId: 'r1', nodeId: 'n1' }, {}))).rejects.toBeInstanceOf(EngineOfflineError)
  })
})

describe('chatWithNode', () => {
  const chat = () => client.chatWithNode({ runId: '2026-09-15-Ab3dE1', nodeId: 'gameplay-director', message: 'defend the sleeves' })

  it('posts the message to the node chat route', async () => {
    engine.chatFrames = [frame({ type: 'chat_done', message: { role: 'assistant', content: 'fair' } })]
    await drainChat(chat())
    const sent = engine.requests.at(-1)!
    expect(sent.method).toBe('POST')
    expect(sent.path).toBe('/api/runs/2026-09-15-Ab3dE1/nodes/gameplay-director/chat')
    expect(JSON.parse(sent.body)).toEqual({ message: 'defend the sleeves' })
  })

  it('yields the chat stream own events, not the run event set', async () => {
    engine.chatFrames = [
      frame({ type: 'token', token: 'weigh', tokenType: 'thought' }),
      frame({ type: 'token', token: 'fair ' }),
      frame({ type: 'token', token: 'point' }),
      frame({ type: 'chat_done', message: { role: 'assistant', content: 'fair point', thought: 'weigh' } }),
    ]
    const events = await drainChat(chat())
    expect(events.map(event => event.type)).toEqual(['token', 'token', 'token', 'chat_done'])
    expect(events[0]).toEqual({ type: 'token', token: 'weigh', tokenType: 'thought' })
    expect(events[3]).toEqual({ type: 'chat_done', message: { role: 'assistant', content: 'fair point', thought: 'weigh' } })
  })

  it('yields the engine error event rather than throwing', async () => {
    engine.chatFrames = [frame({ type: 'error', error: 'the model refused' })]
    expect(await drainChat(chat())).toEqual([{ type: 'error', error: 'the model refused' }])
  })

  it('drops a frame that is not one of the three events this stream sends', async () => {
    engine.chatFrames = [frame({ type: 'agent_start', agentName: 'a', nodeId: 'a', step: 0 }), frame({ type: 'chat_done', message: { role: 'assistant', content: 'x' } })]
    expect((await drainChat(chat())).map(event => event.type)).toEqual(['chat_done'])
  })

  it('throws EngineHttpError carrying the refusal, so the caller can say which one it was', async () => {
    engine.failWith = { status: 409, body: 'run is running' }
    const error = await drainChat(chat()).catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(EngineHttpError)
    expect((error as EngineHttpError).status).toBe(409)
  })

  it('throws EngineOfflineError when the engine is not running', async () => {
    const client = await offlineClient()
    await expect(
      drainChat(client.chatWithNode({ runId: 'r1', nodeId: 'n1', message: 'hi' })),
    ).rejects.toBeInstanceOf(EngineOfflineError)
  })
})

describe('ping', () => {
  it('is true when the engine answers', async () => {
    expect(await client.ping()).toBe(true)
  })

  it('is true even when the engine answers with a failure — it is still up', async () => {
    engine.failWith = { status: 500, body: 'boom' }
    expect(await client.ping()).toBe(true)
  })

  it('probes a route that costs the engine nothing to answer', async () => {
    await client.ping()
    // `/api/workspace` reads every agent, skill, chain, tool and template on
    // disk; a poll every few seconds must not ask for that.
    expect(engine.requests.at(-1)?.path).not.toBe('/api/workspace')
    expect(engine.requests.at(-1)?.method).toBe('GET')
  })

  it('is false when the engine is not running', async () => {
    const client = await offlineClient()
    expect(await client.ping()).toBe(false)
  })

  it('is false when the engine URL is not a URL at all', async () => {
    const client = new EngineClient(() => 'not a url', createNodeTransport())
    expect(await client.ping()).toBe(false)
  })
})

describe('base URL', () => {
  it('is read at call time, so a settings change takes effect immediately', async () => {
    let url = 'http://127.0.0.1:1/'
    const client = new EngineClient(() => url, createNodeTransport())
    expect(await client.ping()).toBe(false)
    url = engine.url
    expect(await client.ping()).toBe(true)
  })

  it('tolerates a trailing slash on the configured URL', async () => {
    const client = new EngineClient(() => `${engine.url}/`, createNodeTransport())
    engine.runMeta = { runId: 'r1', chainName: 'c', status: 'complete', agentOutputs: [] }
    await client.getRun('r1')
    expect(engine.requests.at(-1)?.path).toBe('/api/runs/r1')
  })
})
