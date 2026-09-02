import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EngineClient } from '@/engine/client'
import { createNodeTransport } from '@/engine/nodeTransport'
import { applyRunEvent, buildRunResult, emptyRunState, settleRun, type RunState } from '@/run/session'
import type { ChainSummary } from '@/engine/types'
import { FakeEngine, frame } from './fakeEngine'

/**
 * The quick path end to end: SSE off a real socket, through the client, into the
 * fold, out as the panels the view draws. The pieces are checked on their own
 * elsewhere; this checks that a run on the wire becomes a timeline.
 */

let engine: FakeEngine
let client: EngineClient

beforeEach(async () => {
  engine = await FakeEngine.start()
  client = new EngineClient(() => engine.url, createNodeTransport())
})

afterEach(async () => {
  await engine.stop()
})

const CHAIN: ChainSummary = {
  slug: 'relay',
  name: 'Telephone Relay',
  view: 'timeline',
  outputs: [
    { name: 'hop 1', node: 'first', socket: 'summary' },
    { name: 'skeleton', node: 'second', socket: 'summary' },
  ],
}

/** A panel as the engine sends it. */
const pending = (name: string, node: string) => ({ name, node, text: '', lines: 0, state: 'pending' })
const filled = (name: string, node: string, text: string) =>
  ({ name, node, text, lines: text.trim().split(/\r?\n/).length, state: 'filled' })

/** The frame the engine sends before the first hop and after every agent_done. */
const layout = (panels: unknown[]) => ({
  type: 'layout',
  model: { kind: 'timeline', panels: [panels[0], { ...(panels[1] as object), emphasis: 'last' }] },
})

const agentDone = (nodeId: string, output: string) => ({
  type: 'agent_done',
  agentName: nodeId,
  nodeId,
  step: 0,
  output: {
    nodeId,
    agentName: nodeId,
    output,
    status: 'success',
    timestamp: '2026-09-02T00:00:00.000Z',
  },
})

/** Every state the view was shown, in order — the frames a reader would have seen. */
async function watchRun(): Promise<RunState[]> {
  const frames: RunState[] = []
  let state = emptyRunState()
  for await (const event of client.launchRun({ chainName: 'Telephone Relay', seedPrompt: 'the note' })) {
    state = applyRunEvent(state, event)
    frames.push(state)
  }
  frames.push(settleRun(state))
  return frames
}

const result = (state: RunState) => buildRunResult({ chain: CHAIN, seedSource: 'premise.md', state })

describe('a run on the wire, as the view reads it', () => {
  beforeEach(() => {
    engine.runFrames = [
      // The engine sends the panels before the first hop, so they fill in rather
      // than appear (ADR-0017).
      frame(layout([pending('hop 1', 'first'), pending('skeleton', 'second')])),
      frame({ type: 'agent_start', agentName: 'summariser', nodeId: 'first', step: 0 }),
      frame({ type: 'token', nodeId: 'first', token: '## Summary\n' }),
      frame({ type: 'token', nodeId: 'first', token: 'the short ' }),
      frame({ type: 'token', nodeId: 'first', token: 'version' }),
      frame(agentDone('first', '## Summary\nthe short version')),
      frame(layout([filled('hop 1', 'first', 'the short version'), pending('skeleton', 'second')])),
      frame({ type: 'agent_start', agentName: 'summariser', nodeId: 'second', step: 1 }),
      frame(agentDone('second', '## Summary\nwhat survived')),
      frame(layout([
        filled('hop 1', 'first', 'the short version'),
        filled('skeleton', 'second', 'what survived'),
      ])),
      frame({ type: 'run_complete', runId: '2026-09-02-ab12c' }),
    ]
  })

  it('sends the note as the run seed', async () => {
    await watchRun()
    expect(JSON.parse(engine.requests[0].body)).toMatchObject({
      chainName: 'Telephone Relay',
      seedPrompt: 'the note',
    })
  })

  it('has the panels before the first hop starts, so they fill in rather than appear', async () => {
    const frames = await watchRun()
    expect(result(frames[0]).layout.panels.map(p => [p.name, p.state])).toEqual([
      ['hop 1', 'pending'],
      ['skeleton', 'pending'],
    ])
  })

  it('shows the first hop writing before it has reported', async () => {
    const frames = await watchRun()
    const midStream = result(frames[3]).layout.panels[0]
    expect(midStream).toMatchObject({ state: 'pending', streaming: 'the short' })
  })

  it('holds the partial through agent_done, so the panel does not blank for a beat', async () => {
    const frames = await watchRun()
    expect(result(frames[5]).layout.panels[0]).toMatchObject({ state: 'pending', streaming: 'the short version' })
  })

  it('replaces the partial with the engine settled panel when the frame lands', async () => {
    const frames = await watchRun()
    const landed = result(frames[6]).layout.panels[0]
    expect(landed).toMatchObject({ state: 'filled', text: 'the short version' })
    expect(landed.streaming).toBeUndefined()
  })

  it('leaves the hops it has not reached pending', async () => {
    const frames = await watchRun()
    expect(result(frames[6]).layout.panels.map(p => p.state)).toEqual(['filled', 'pending'])
  })

  it('ends as a finished timeline, with the last panel emphasised and the run id in hand', async () => {
    const frames = await watchRun()
    const final = result(frames[frames.length - 1])
    expect(final.status).toBe('done')
    expect(final.runId).toBe('2026-09-02-ab12c')
    expect(final.layout.kind).toBe('timeline')
    expect(final.layout.panels.map(p => [p.name, p.state, p.emphasis])).toEqual([
      ['hop 1', 'filled', undefined],
      ['skeleton', 'filled', 'last'],
    ])
  })
})

describe('a run the engine could not finish', () => {
  it('settles as failed, carrying what the engine said', async () => {
    engine.runFrames = [
      frame(layout([pending('hop 1', 'first'), pending('skeleton', 'second')])),
      frame({ type: 'agent_start', agentName: 'summariser', nodeId: 'first', step: 0 }),
      frame({ type: 'error', error: 'the model refused' }),
    ]
    const frames = await watchRun()
    expect(result(frames[frames.length - 1])).toMatchObject({ status: 'failed', error: 'the model refused' })
  })

  it('leaves the hop that never ran saying so, once nothing is coming', async () => {
    engine.runFrames = [
      frame(layout([pending('hop 1', 'first'), pending('skeleton', 'second')])),
      frame({ type: 'error', error: 'no such chain' }),
    ]
    const frames = await watchRun()
    expect(result(frames[frames.length - 1]).layout.panels.map(p => p.state)).toEqual(['pending', 'pending'])
  })

  it('draws nothing at all when the engine failed before it sent any panels', async () => {
    engine.runFrames = [frame({ type: 'error', error: 'no such chain' })]
    const frames = await watchRun()
    expect(result(frames[frames.length - 1]).layout.panels).toEqual([])
  })
})
