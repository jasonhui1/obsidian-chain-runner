import { describe, it, expect } from 'vitest'
import { applyRunEvent, buildRunResult, emptyRunState, settleRun, type RunState } from '@/run/session'
import type { AgentOutput, ChainSummary, RunEvent } from '@/engine/types'

const CHAIN: ChainSummary = {
  slug: 'relay',
  name: 'Telephone Relay',
  moment: 'finalizing a doc, not sure it holds up',
  view: 'timeline',
  outputs: [
    { name: 'hop 1', node: 'first', socket: 'summary' },
    { name: 'skeleton', node: 'second', socket: 'summary' },
  ],
}

function fold(...events: RunEvent[]): RunState {
  return events.reduce(applyRunEvent, emptyRunState())
}

function done(nodeId: string, output: string, over: Partial<AgentOutput> = {}): RunEvent {
  return {
    type: 'agent_done',
    agentName: `${nodeId}-agent`,
    nodeId,
    step: 0,
    output: {
      nodeId,
      agentName: `${nodeId}-agent`,
      output,
      status: 'success',
      timestamp: '2026-09-02T00:00:00.000Z',
      ...over,
    },
  }
}

/** One panel as the engine sends it: pending, and carrying the node it binds to. */
const PANEL = { name: 'hop 1', node: 'first', text: '', lines: 0, state: 'pending' as const }

const start = (nodeId: string): RunEvent => ({ type: 'agent_start', agentName: `${nodeId}-agent`, nodeId, step: 0 })
const token = (nodeId: string, text: string, over: Record<string, unknown> = {}): RunEvent =>
  ({ type: 'token', nodeId, token: text, ...over })

describe('applyRunEvent', () => {
  it('records the nodes that started, in order, with the agent each runs', () => {
    expect(fold(start('first'), start('second')).nodes.started).toEqual([
      { nodeId: 'first', agentName: 'first-agent' },
      { nodeId: 'second', agentName: 'second-agent' },
    ])
  })

  it('accumulates a node output tokens', () => {
    expect(fold(start('first'), token('first', 'ab'), token('first', 'cd')).nodes.streaming.first).toBe('abcd')
  })

  it('keeps reasoning tokens out of the output, since the engine overwrites neither with the other', () => {
    const state = fold(start('first'), token('first', 'thinking', { tokenType: 'thought' }), token('first', 'said'))
    expect(state.nodes.streaming.first).toBe('said')
  })

  it('keeps a tool turn narration out of the output', () => {
    const state = fold(start('first'), token('first', 'chatter', { turn: 1 }), token('first', 'said'))
    expect(state.nodes.streaming.first).toBe('said')
  })

  it('keeps the partial past agent_done, since the layout frame lands a beat later', () => {
    const state = fold(start('first'), token('first', 'half'), done('first', 'whole'))
    expect(state.nodes.streaming.first).toBe('half')
    expect(state.nodes.outputs).toHaveLength(1)
  })

  it('takes the panels from the engine layout frame', () => {
    const model = { kind: 'timeline' as const, panels: [] }
    expect(fold({ type: 'layout', model }).layout).toEqual(model)
  })

  it('keeps only the newest frame, since each carries the whole projection', () => {
    const first = { kind: 'timeline' as const, panels: [] }
    const second = { kind: 'timeline' as const, panels: [PANEL] }
    expect(fold({ type: 'layout', model: first }, { type: 'layout', model: second }).layout).toEqual(second)
  })

  it('starts a node clean when it runs again, so a second round does not read the first', () => {
    const state = fold(start('first'), token('first', 'round one'), start('first'), token('first', 'round two'))
    expect(state.nodes.streaming.first).toBe('round two')
    expect(state.nodes.started).toHaveLength(1)
  })

  it('records a node that reported without a start it saw', () => {
    expect(fold(done('ghost', 'x')).nodes.started).toEqual([{ nodeId: 'ghost', agentName: 'ghost-agent' }])
  })

  it('takes the run id from run_complete', () => {
    expect(fold({ type: 'run_complete', runId: '2026-09-02-ab12c' }).runId).toBe('2026-09-02-ab12c')
  })

  it('takes the message from an engine error event', () => {
    expect(fold({ type: 'error', error: 'no such chain' }).error).toBe('no such chain')
  })

  it('ignores an event it does not model', () => {
    expect(fold({ type: 'section_missing', nodeId: 'first' })).toEqual(emptyRunState())
  })
})

describe('buildRunResult', () => {
  const result = (state: RunState, paramValue?: string) =>
    buildRunResult({ chain: CHAIN, seedSource: 'premise.md', state, paramValue })

  it('is running until the stream closes', () => {
    expect(result(fold(start('first'))).status).toBe('running')
  })

  it('is done once it settles with nothing failed', () => {
    expect(result(settleRun(fold(done('first', '## Summary\nx')))).status).toBe('done')
  })

  it('fails on an engine error, and says what it said', () => {
    const state = settleRun(fold({ type: 'error', error: 'no such chain' }))
    expect(result(state)).toMatchObject({ status: 'failed', error: 'no such chain' })
  })

  it('fails when a hop failed, even though the run itself finished', () => {
    const state = settleRun(fold(done('first', '', { status: 'error', error: 'the model refused' })))
    expect(result(state)).toMatchObject({ status: 'failed', error: 'the model refused' })
  })

  it('carries the failure the caller could not get through a node', () => {
    const state = settleRun(fold(start('first')), 'engine offline')
    expect(result(state)).toMatchObject({ status: 'failed', error: 'engine offline' })
  })

  it('names the chain, the moment it is for, and where the seed came from', () => {
    expect(result(emptyRunState())).toMatchObject({
      chainName: 'Telephone Relay',
      moment: 'finalizing a doc, not sure it holds up',
      seedSource: 'premise.md',
    })
  })

  it('falls back to the chain description when it states no moment', () => {
    const chain: ChainSummary = { slug: 'x', name: 'X', description: 'the mechanism' }
    const built = buildRunResult({ chain, seedSource: 'a.md', state: emptyRunState() })
    expect(built.moment).toBe('the mechanism')
  })

  it('shows the dropdown the chain declared and what it was set to', () => {
    const chain: ChainSummary = { ...CHAIN, parameter: { name: 'audience', options: ['execs'] } }
    const built = buildRunResult({ chain, seedSource: 'a.md', state: emptyRunState(), paramValue: 'execs' })
    expect(built.parameter).toEqual({ name: 'audience', value: 'execs' })
  })

  it('has no parameter when the chain declares none', () => {
    expect(result(emptyRunState(), 'ignored').parameter).toBeUndefined()
  })

  it('draws the engine panels, with live tokens laid over the one still writing', () => {
    const model = {
      kind: 'timeline' as const,
      panels: [PANEL, { ...PANEL, name: 'skeleton', node: 'second', emphasis: 'last' as const }],
    }
    const built = result(fold({ type: 'layout', model }, start('first'), token('first', '## Summary\nhalf')))
    expect(built.layout.kind).toBe('timeline')
    expect(built.layout.panels.map(p => p.name)).toEqual(['hop 1', 'skeleton'])
    expect(built.layout.panels[0].streaming).toBe('half')
  })
})
