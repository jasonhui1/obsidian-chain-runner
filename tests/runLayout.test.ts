import { describe, it, expect } from 'vitest'
import { buildRunLayout } from '@/run/layout'
import type { RunNodes } from '@/run/layout'
import type { AgentOutput, ChainSummary } from '@/engine/types'

function run(over: Partial<RunNodes> = {}): RunNodes {
  return { outputs: [], streaming: {}, started: [], ...over }
}

function output(nodeId: string, text: string, over: Partial<AgentOutput> = {}): AgentOutput {
  return {
    nodeId,
    agentName: nodeId,
    output: text,
    status: 'success',
    timestamp: '2026-09-02T00:00:00.000Z',
    ...over,
  }
}

function started(nodeId: string) {
  return { nodeId, agentName: `${nodeId}-agent` }
}

const timeline: ChainSummary = {
  slug: 'relay',
  name: 'Telephone Relay',
  view: 'timeline',
  outputs: [
    { name: 'hop 1', node: 'first', socket: 'summary' },
    { name: 'hop 2', node: 'second', socket: 'summary' },
    { name: 'skeleton', node: 'third', socket: 'summary' },
  ],
}

const SUMMARY = '## Summary\nthe short version'

describe('buildRunLayout: a declared timeline', () => {
  it('is one panel per declared port, in reading order', () => {
    const layout = buildRunLayout(timeline, run())
    expect(layout.kind).toBe('timeline')
    expect(layout.panels.map(p => p.name)).toEqual(['hop 1', 'hop 2', 'skeleton'])
  })

  it('emphasises the last panel as the surviving skeleton', () => {
    const layout = buildRunLayout(timeline, run())
    expect(layout.panels.map(p => p.emphasis)).toEqual([undefined, undefined, 'last'])
  })

  it('shows the section the port asked for, not the whole output', () => {
    const layout = buildRunLayout(timeline, run({ outputs: [output('first', `# Note
chatter
${SUMMARY}`)] }))
    expect(layout.panels[0]).toMatchObject({ state: 'filled', text: 'the short version', lines: 1 })
  })

  it('fills panels in as hops land, leaving the rest pending', () => {
    const layout = buildRunLayout(timeline, run({ outputs: [output('first', SUMMARY)] }))
    expect(layout.panels.map(p => p.state)).toEqual(['filled', 'pending', 'pending'])
  })

  it('takes the node last write, so a re-reporting node shows where it ended up', () => {
    const outputs = [output('first', '## Summary\nfirst try'), output('first', '## Summary\nsecond try')]
    expect(buildRunLayout(timeline, run({ outputs })).panels[0].text).toBe('second try')
  })
})

describe('buildRunLayout: panel states', () => {
  it('is empty when a finished hop dropped the section the chain asked for', () => {
    const layout = buildRunLayout(timeline, run({ outputs: [output('first', 'no headings here')] }))
    expect(layout.panels[0].state).toBe('empty')
  })

  it('is errored, and carries the engine own message, when the hop failed', () => {
    const failed = output('first', '', { status: 'error', error: 'the model refused' })
    expect(buildRunLayout(timeline, run({ outputs: [failed] })).panels[0]).toMatchObject({
      state: 'errored',
      error: 'the model refused',
    })
  })

  it('is skipped when control flow went the other way', () => {
    const skipped = output('first', '', { status: 'skipped' })
    expect(buildRunLayout(timeline, run({ outputs: [skipped] })).panels[0].state).toBe('skipped')
  })
})

describe('buildRunLayout: streaming', () => {
  it('hands a pending panel the tokens its node has produced so far', () => {
    const streaming = { first: `## Summary\nhalf a sen` }
    const layout = buildRunLayout(timeline, run({ streaming }))
    expect(layout.panels[0]).toMatchObject({ state: 'pending', streaming: 'half a sen' })
  })

  it('leaves a settled panel alone', () => {
    const layout = buildRunLayout(timeline, run({ outputs: [output('first', SUMMARY)], streaming: { first: 'stale' } }))
    expect(layout.panels[0].streaming).toBeUndefined()
  })

  it('says nothing while the socket the port asked for has not been written yet', () => {
    const layout = buildRunLayout(timeline, run({ streaming: { first: 'preamble with no heading' } }))
    expect(layout.panels[0].streaming).toBeUndefined()
  })
})

describe('buildRunLayout: columns and sidebar', () => {
  const columns: ChainSummary = {
    slug: 'personas',
    name: 'Five Personas',
    view: 'columns',
    outputs: [
      { name: 'optimist', node: 'a' },
      { name: 'skeptic', node: 'b' },
      { name: 'where they collide', node: 'join', role: 'join' },
    ],
  }

  it('emphasises the declared join and nothing else', () => {
    const layout = buildRunLayout(columns, run())
    expect(layout.kind).toBe('columns')
    expect(layout.panels.map(p => p.emphasis)).toEqual([undefined, undefined, 'join'])
  })

  const sidebar: ChainSummary = {
    slug: 'loop',
    name: 'Sharpen',
    view: 'sidebar',
    outputs: [{ name: 'draft', node: 'body' }],
  }

  it('gives one declared port one panel per round', () => {
    const outputs = [output('body', 'first pass', { round: 0 }), output('body', 'second pass', { round: 1 })]
    const layout = buildRunLayout(sidebar, run({ outputs }))
    expect(layout.panels.map(p => p.name)).toEqual(['draft · round 1', 'draft · round 2'])
  })

  it('shows the first round streaming before it has reported', () => {
    const layout = buildRunLayout(sidebar, run({ streaming: { body: 'writing' } }))
    expect(layout.panels).toHaveLength(1)
    expect(layout.panels[0]).toMatchObject({ round: 0, state: 'pending', streaming: 'writing' })
  })
})

describe('buildRunLayout: a chain that declares no layout', () => {
  const bare: ChainSummary = { slug: 'bare', name: 'Bare' }

  it('falls back to the run trace: one panel per node, in the order they ran', () => {
    const layout = buildRunLayout(bare, run({
      outputs: [output('second', 'B'), output('first', 'A')],
      started: [started('first'), started('second')],
    }))
    expect(layout.kind).toBe('undeclared')
    expect(layout.panels.map(p => p.text)).toEqual(['A', 'B'])
  })

  it('shows a trace panel whole, since no port named a section of it', () => {
    const layout = buildRunLayout(bare, run({ outputs: [output('first', `chatter
${SUMMARY}`)], started: [started('first')] }))
    expect(layout.panels[0].text).toContain('chatter')
  })

  it('streams a node that has started but not reported', () => {
    const layout = buildRunLayout(bare, run({ streaming: { first: 'half a sen' }, started: [started('first')] }))
    expect(layout.panels[0]).toMatchObject({ state: 'pending', streaming: 'half a sen' })
  })

  it('has no panels before anything has run', () => {
    expect(buildRunLayout(bare, run()).panels).toEqual([])
  })
})
