import { describe, it, expect } from 'vitest'
import { buildRunPanels, emptyRunNodes, type RunNodes } from '@/run/panels'
import type { AgentOutput, ChainSummary, LayoutModel, LayoutPanel } from '@/engine/types'

/**
 * The plugin no longer projects panels — the engine streams them (ADR-0017).
 * What is left to check is the two things the engine has no reason to know
 * about: half-written tokens, and a chain that declares no layout at all.
 */

function run(over: Partial<RunNodes> = {}): RunNodes {
  return { ...emptyRunNodes(), ...over }
}

function panel(over: Partial<LayoutPanel> = {}): LayoutPanel {
  return { name: 'hop 1', node: 'first', text: '', lines: 0, state: 'pending', ...over }
}

const model = (panels: LayoutPanel[], kind: LayoutModel['kind'] = 'timeline'): LayoutModel => ({ kind, panels })

function output(nodeId: string, text: string, over: Partial<AgentOutput> = {}): AgentOutput {
  return {
    nodeId,
    agentName: `${nodeId}-agent`,
    output: text,
    status: 'success',
    timestamp: '2026-09-02T00:00:00.000Z',
    ...over,
  }
}

const CHAIN: ChainSummary = {
  slug: 'relay',
  name: 'Telephone Relay',
  view: 'timeline',
  outputs: [
    { name: 'hop 1', node: 'first', socket: 'summary' },
    { name: 'skeleton', node: 'second', socket: 'summary' },
  ],
}

describe('buildRunPanels: the engine panels, drawn as sent', () => {
  it('passes the engine panels through, kind and all', () => {
    const sent = model([panel({ name: 'hop 1' }), panel({ name: 'skeleton', node: 'second', emphasis: 'last' })])
    const built = buildRunPanels(CHAIN, sent, run())
    expect(built.kind).toBe('timeline')
    expect(built.panels.map(p => [p.name, p.emphasis])).toEqual([['hop 1', undefined], ['skeleton', 'last']])
  })

  it('does not second-guess a state the engine decided', () => {
    const sent = model([panel({ state: 'empty' })])
    expect(buildRunPanels(CHAIN, sent, run({ outputs: [output('first', 'plenty of text')] })).panels[0].state)
      .toBe('empty')
  })
})

describe('buildRunPanels: the token overlay', () => {
  it('hands a pending panel what its node has written, keyed by node', () => {
    const sent = model([panel(), panel({ name: 'skeleton', node: 'second' })])
    const built = buildRunPanels(CHAIN, sent, run({ streaming: { first: '## Summary\nhalf a sen' } }))
    expect(built.panels[0].streaming).toBe('half a sen')
    expect(built.panels[1].streaming).toBeUndefined()
  })

  it('scopes the partial to the socket the port asked for, so nothing shows twice', () => {
    const streaming = { first: 'preamble the port never asked for' }
    expect(buildRunPanels(CHAIN, model([panel()]), run({ streaming })).panels[0].streaming).toBeUndefined()
  })

  it('leaves a panel the engine has filled alone', () => {
    const sent = model([panel({ state: 'filled', text: 'the short version', lines: 1 })])
    const built = buildRunPanels(CHAIN, sent, run({ streaming: { first: '## Summary\nstale' } }))
    expect(built.panels[0].streaming).toBeUndefined()
  })

  it('shows the raw partial when two ports on one node disagree about the socket', () => {
    const twoPorts: ChainSummary = {
      ...CHAIN,
      outputs: [
        { name: 'summary', node: 'first', socket: 'summary' },
        { name: 'risks', node: 'first', socket: 'risks' },
      ],
    }
    const built = buildRunPanels(twoPorts, model([panel()]), run({ streaming: { first: 'still writing' } }))
    expect(built.panels[0].streaming).toBe('still writing')
  })
})

describe('buildRunPanels: a chain that declares no layout', () => {
  const bare: ChainSummary = { slug: 'bare', name: 'Bare' }
  const undeclared = model([], 'undeclared')

  it('falls back to the run trace on the engine own cue, rather than waiting for a frame', () => {
    const nodes = run({
      outputs: [output('second', 'B'), output('first', 'A')],
      started: [
        { nodeId: 'first', agentName: 'first-agent' },
        { nodeId: 'second', agentName: 'second-agent' },
      ],
    })
    const built = buildRunPanels(bare, undeclared, nodes)
    expect(built.kind).toBe('undeclared')
    expect(built.panels.map(p => [p.name, p.text])).toEqual([
      ['first-agent', 'A'],
      ['second-agent', 'B'],
    ])
  })

  it('reads a failed node as errored, carrying the engine message', () => {
    const nodes = run({
      outputs: [output('first', '', { status: 'error', error: 'the model refused' })],
      started: [{ nodeId: 'first', agentName: 'first-agent' }],
    })
    expect(buildRunPanels(bare, undeclared, nodes).panels[0]).toMatchObject({
      state: 'errored',
      error: 'the model refused',
    })
  })

  it('streams a node that has started and not reported', () => {
    const nodes = run({ streaming: { first: 'half a sen' }, started: [{ nodeId: 'first', agentName: 'a' }] })
    expect(buildRunPanels(bare, undeclared, nodes).panels[0].streaming).toBe('half a sen')
  })

  it('draws nothing before the first frame arrives, which is when there is nothing to draw', () => {
    expect(buildRunPanels(CHAIN, undefined, run()).panels).toEqual([])
  })
})
