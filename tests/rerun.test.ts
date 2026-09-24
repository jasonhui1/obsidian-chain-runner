import { describe, it, expect } from 'vitest'
import { rerunRequest, runFork, UNSUPPORTED_FORK } from '@/run/rerun'
import { EngineHttpError } from '@/engine/transport'
import type { AgentOutput, LayoutPanel, RunMeta } from '@/engine/types'
import { refusingEngine, streamingEngine } from './stubEngine'

/** The fork request built from edited proposals, apart from the vault. */

const SPECIALISTS = ['character-director', 'gameplay-director', 'world-director', 'art-director', 'devils-advocate']

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
  ...over,
})

const panel = (node: string, text = `${node} said this.`): LayoutPanel => ({ name: node, node, text, lines: 1, state: 'filled' })

const panels = SPECIALISTS.map(node => panel(node))

describe('rerunRequest', () => {
  it('sends only revised nodes and leaves replay selection to the engine', () => {
    const request = rerunRequest(run(), panels, { 'gameplay-director': 'Halo is a burden.' }, undefined)
    expect(request).toEqual({ revisions: { 'gameplay-director': 'Halo is a burden.' } })
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
    expect(request.revisions['gameplay-director']).toBe('## Pitch\nBurden.\n\n## Notes\nKeep it fast.')
  })

  it('keeps each revision when one revised node lies downstream of another', () => {
    const request = rerunRequest(run(), [...panels, panel('join')], { 'creative-brief': 'A new brief.', join: 'A new room.' }, undefined)
    expect(request.revisions).toEqual({ 'creative-brief': 'A new brief.', join: 'A new room.' })
  })

  it('sends today’s canon with the revisions', () => {
    expect(rerunRequest(run(), panels, { 'gameplay-director': 'x' }, '## LOCKED\n- halo = burden\n')).toEqual({
      revisions: { 'gameplay-director': 'x' },
      context: { 'canon-anime-game': '## LOCKED\n- halo = burden\n' },
    })
  })

  it('can request the source run’s pinned files', () => {
    expect(rerunRequest(run(), panels, { 'gameplay-director': 'x' }, undefined, 'pinned')).toEqual({
      revisions: { 'gameplay-director': 'x' },
      versions: 'pinned',
    })
  })

  it('uses the latest output when a node has more than one record', () => {
    const records = [...run().agentOutputs, output('gameplay-director', '## Pitch\nFinal.\n\n## Notes\nKeep it fast.')]
    const request = rerunRequest(run({ agentOutputs: records }), [panel('gameplay-director', 'Final.')], { 'gameplay-director': 'Burden.' }, undefined)
    expect(request.revisions['gameplay-director']).toBe('## Pitch\nBurden.\n\n## Notes\nKeep it fast.')
  })
})

describe('runFork', () => {
  const request = { revisions: { 'gameplay-director': 'Burden.' } }

  it('calls the fork route and reads its run of record', async () => {
    const called: unknown[] = []
    const result = await runFork(streamingEngine([{ type: 'run_start', runId: 'forked' }], { runFork: true }, called), 'source', request)
    expect(called).toEqual(['source'])
    expect(result).toEqual({ kind: 'landed', runId: 'forked', forked: true })
  })

  it('asks nothing of an engine that does not advertise the fork route', async () => {
    const result = await runFork(refusingEngine(new Error('must not call')), 'source', request)
    expect(result).toEqual({ kind: 'refused', said: UNSUPPORTED_FORK, unsupported: true })
  })

  it.each([
    [400, 'revising a hold; use resume', 'The engine would not rerun downstream: revising a hold; use resume'],
    [400, 'node inside a loop', 'The engine would not rerun downstream: node inside a loop'],
    [400, 'node has no output', 'The engine would not rerun downstream: node has no output'],
    [404, 'unknown node', 'This run or a revised node no longer exists'],
  ])('shows the engine refusal for %i', async (status, said, notice) => {
    const engine = refusingEngine(new EngineHttpError(status, 'http://engine/fork', JSON.stringify({ error: said })), { runFork: true })
    expect(await runFork(engine, 'source', request)).toEqual({ kind: 'refused', said: notice })
  })
})
