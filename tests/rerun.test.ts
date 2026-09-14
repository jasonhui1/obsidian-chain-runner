import { describe, it, expect } from 'vitest'
import { descendants, rerunRequest } from '@/run/rerun'
import type { AgentOutput, LayoutPanel, RunGraph, RunMeta } from '@/engine/types'

/**
 * Rerun-downstream, apart from the vault: which outputs a revision replays, and
 * the request that replays them.
 */

const SPECIALISTS = ['character-director', 'gameplay-director', 'world-director', 'art-director', 'devils-advocate']

/** The creative-director chain's shape, down to what the rule reads. */
const graph: RunGraph = {
  edges: [
    ...['creative-brief', ...SPECIALISTS, 'creative-director'].flatMap(to =>
      ['seed', 'experimental', 'canon'].map(fromNode => ({ fromNode, toNode: to })),
    ),
    ...SPECIALISTS.map(toNode => ({ fromNode: 'creative-brief', toNode })),
    ...SPECIALISTS.map(fromNode => ({ fromNode, toNode: 'join' })),
    { fromNode: 'creative-brief', toNode: 'creative-director' },
    { fromNode: 'join', toNode: 'creative-director' },
    { fromNode: 'creative-director', toNode: 'report' },
  ],
}

const output = (nodeId: string, text = `${nodeId} said this.`): AgentOutput => ({
  nodeId,
  agentName: nodeId,
  output: text,
  status: 'success',
  timestamp: '2026-09-15T10:00:00.000Z',
})

const run = (over: Partial<RunMeta> = {}): RunMeta => ({
  runId: '2026-09-15-Ab3dE1',
  chainName: 'creative-director',
  seedPrompt: 'anime girl with a giant mechanical halo',
  parameter: { name: 'experimental', value: '3 - fresh' },
  startedAt: '2026-09-15T10:00:00.000Z',
  status: 'complete',
  agentOutputs: ['creative-brief', ...SPECIALISTS, 'join', 'creative-director', 'report'].map(id => output(id)),
  graph,
  ...over,
})

const panel = (node: string, text = `${node} said this.`): LayoutPanel => ({ name: node, node, text, lines: 1, state: 'filled' })

const panels = SPECIALISTS.map(node => panel(node))

const replayedNodes = (request: ReturnType<typeof rerunRequest>) => request?.branchOutputs?.map(o => o.nodeId)

describe('descendants', () => {
  it('holds the node itself and everything reachable from it', () => {
    expect([...descendants(graph, 'gameplay-director')].sort()).toEqual(['creative-director', 'gameplay-director', 'join', 'report'])
  })

  it('reaches no sibling that only shares an upstream', () => {
    expect(descendants(graph, 'gameplay-director').has('world-director')).toBe(false)
  })
})

describe('rerunRequest', () => {
  it('replays every output but the revised node’s descendants', () => {
    const request = rerunRequest(run(), panels, { 'gameplay-director': 'Halo is a burden.' }, undefined)
    expect(replayedNodes(request)).toEqual(['creative-brief', ...SPECIALISTS])
  })

  it('replays the edited text as the revised node’s output, rather than letting it regenerate', () => {
    const request = rerunRequest(run(), panels, { 'gameplay-director': 'Halo is a burden.' }, undefined)
    const revised = request?.branchOutputs?.find(o => o.nodeId === 'gameplay-director')
    expect(revised).toMatchObject({ agentName: 'gameplay-director', output: 'Halo is a burden.', status: 'success' })
  })

  it('drops the stored thought from the revision, since it reasoned toward the old text', () => {
    const outputs = run().agentOutputs.map(o => (o.nodeId === 'gameplay-director' ? { ...o, thought: 'Stances first.' } : o))
    const request = rerunRequest(run({ agentOutputs: outputs }), panels, { 'gameplay-director': 'Halo is a burden.' }, undefined)
    expect(request?.branchOutputs?.find(o => o.nodeId === 'gameplay-director')).not.toHaveProperty('thought')
  })

  it('swaps only the panel’s part of an output that carried more than the panel shows', () => {
    const outputs = run().agentOutputs.map(o =>
      o.nodeId === 'gameplay-director' ? { ...o, output: '## Pitch\nStances.\n\n## Notes\nKeep it fast.' } : o,
    )
    const request = rerunRequest(
      run({ agentOutputs: outputs }),
      [panel('gameplay-director', 'Stances.')],
      { 'gameplay-director': 'Burden.' },
      undefined,
    )
    expect(request?.branchOutputs?.find(o => o.nodeId === 'gameplay-director')?.output).toBe('## Pitch\nBurden.\n\n## Notes\nKeep it fast.')
  })

  it('keeps each revision when one revised node lies downstream of another', () => {
    const request = rerunRequest(run(), [...panels, panel('join')], { 'creative-brief': 'A new brief.', join: 'A new room.' }, undefined)
    expect(replayedNodes(request)).toEqual(['creative-brief', 'join'])
  })

  it('branches from the run, with its seed and parameter pick', () => {
    expect(rerunRequest(run(), panels, { 'gameplay-director': 'x' }, undefined)).toMatchObject({
      chainName: 'creative-director',
      seedPrompt: 'anime girl with a giant mechanical halo',
      paramValue: '3 - fresh',
      branchedFromRunId: '2026-09-15-Ab3dE1',
    })
  })

  it('sends today’s canon, since a context node is read fresh on every run rather than replayed', () => {
    expect(rerunRequest(run(), panels, { 'gameplay-director': 'x' }, '## LOCKED\n- halo = burden\n')).toMatchObject({
      context: { 'canon-anime-game': '## LOCKED\n- halo = burden\n' },
    })
  })

  it('answers undefined for a run that carries no graph to walk', () => {
    expect(rerunRequest(run({ graph: undefined }), panels, { 'gameplay-director': 'x' }, undefined)).toBeUndefined()
  })
})
