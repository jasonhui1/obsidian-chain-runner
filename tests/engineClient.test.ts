import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EngineClient } from '@/engine/client'
import { createNodeTransport } from '@/engine/nodeTransport'
import { EngineHttpError, EngineOfflineError } from '@/engine/transport'
import type { RunEvent } from '@/engine/types'
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

/** A client pointed at a port with nothing behind it. */
async function offlineClient(): Promise<EngineClient> {
  const dead = await FakeEngine.start()
  const url = dead.url
  await dead.stop()
  return new EngineClient(() => url, createNodeTransport())
}

describe('listChains', () => {
  it('returns each chain narrowed to what the picker shows', async () => {
    engine.chains = [
      {
        slug: 'five-personas',
        name: 'Five Personas',
        description: 'unused by the picker',
        moment: 'when a premise feels safe',
        purpose: 'insight',
        parameter: { name: 'audience', options: ['engineers', 'execs'], node: 'param' },
        nodes: [],
        edges: [],
      },
      { slug: 'bare', name: 'Bare', description: '', nodes: [], edges: [] },
    ]
    expect(await client.listChains()).toEqual([
      {
        slug: 'five-personas',
        name: 'Five Personas',
        moment: 'when a premise feels safe',
        purpose: 'insight',
        parameter: { name: 'audience', options: ['engineers', 'execs'] },
      },
      { slug: 'bare', name: 'Bare' },
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
