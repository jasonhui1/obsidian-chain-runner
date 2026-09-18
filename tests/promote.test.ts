import { describe, it, expect } from 'vitest'
import { promoteRequest, runPromote, UNSUPPORTED_PROMOTE, type PromotedReply } from '@/run/promote'
import { CANON_CONTEXT_KEY } from '@/run/canon'
import { EngineHttpError, EngineOfflineError } from '@/engine/transport'
import type { Capabilities } from '@/engine/types'
import { refusingEngine, streamingEngine } from './stubEngine'

/**
 * Promote's call, apart from the vault: what it asks the engine for, which run
 * it reads back out of the stream, and what it says to each refusal.
 */

const PROMOTES: Capabilities = { nodePromote: true }
const RUN = '2026-09-15-Ab3dE1'
const FORK = '2026-09-20-Forked'

const reply = (extra: Partial<PromotedReply> = {}): PromotedReply => ({
  runId: RUN,
  nodeId: 'gameplay-director',
  name: 'gameplay-director',
  ...extra,
})

describe('promoteRequest', () => {
  it('names the turn the note recorded, which is the `### Turn N` of the node’s log', () => {
    expect(promoteRequest(reply({ turn: 3 }))).toMatchObject({ turn: 3 })
  })

  it('names no turn when the note recorded none, which promotes the node’s last reply', () => {
    expect(promoteRequest(reply())).toEqual({})
  })

  it('carries canon along, since a context node is read again on the run that follows', () => {
    expect(promoteRequest(reply({ canon: '- LOCKED: halo is a burden' }))).toMatchObject({
      context: { [CANON_CONTEXT_KEY]: '- LOCKED: halo is a burden' },
    })
  })
})

describe('runPromote', () => {
  it('promotes on the node the reply was given by', async () => {
    const seen: unknown[] = []
    await runPromote(streamingEngine([{ type: 'run_complete', runId: RUN }], PROMOTES, seen), reply())
    expect(seen).toEqual([{ runId: RUN, nodeId: 'gameplay-director' }])
  })

  it('reads back the same run when the engine reran to the hold in place', async () => {
    const outcome = await runPromote(streamingEngine([{ type: 'run_start', runId: RUN }, { type: 'run_complete', runId: RUN }], PROMOTES), reply())
    expect(outcome).toEqual({ kind: 'landed', runId: RUN, forked: false })
  })

  it('reads back the fork’s own id, not the run it was called on', async () => {
    const outcome = await runPromote(streamingEngine([{ type: 'run_start', runId: FORK }, { type: 'run_complete', runId: FORK }], PROMOTES), reply())
    expect(outcome).toEqual({ kind: 'landed', runId: FORK, forked: true })
  })

  it('hears every event on the way, so a panel can draw what is being written again', async () => {
    const heard: string[] = []
    await runPromote(streamingEngine([{ type: 'run_start', runId: RUN }, { type: 'run_complete', runId: RUN }], PROMOTES), reply(), event => {
      heard.push(event.type)
    })
    expect(heard).toEqual(['run_start', 'run_complete'])
  })

  it('reports an engine error event as the run’s failure, not as a refusal', async () => {
    const outcome = await runPromote(streamingEngine([{ type: 'run_start', runId: RUN }, { type: 'error', error: 'the model refused' }], PROMOTES), reply())
    expect(outcome).toEqual({ kind: 'landed', runId: RUN, error: 'the model refused', forked: false })
  })

  it.each([
    [409, 'run is running', `Run ${RUN} is still running — use gameplay-director's reply once it stops`],
    [404, 'unknown node', `Run ${RUN} no longer has a node for gameplay-director`],
    [400, 'node is inside a loop', "gameplay-director's reply cannot be used as the revision: node is inside a loop"],
    [400, 'turn 4 is out of range', "gameplay-director's reply cannot be used as the revision: turn 4 is out of range"],
    [400, 'node is not a proposer', "gameplay-director's reply cannot be used as the revision: node is not a proposer"],
  ])('says why rather than throwing when the engine refuses with %i', async (status, said, notice) => {
    const engine = refusingEngine(new EngineHttpError(status, 'http://engine/promote', JSON.stringify({ error: said })), PROMOTES)
    expect(await runPromote(engine, reply())).toEqual({ kind: 'refused', said: notice })
  })

  it('falls back to the engine’s own words on a status promote has nothing of its own to say about', async () => {
    const engine = refusingEngine(new EngineHttpError(500, 'http://engine/promote', 'boom'), PROMOTES)
    expect(await runPromote(engine, reply())).toEqual({ kind: 'refused', said: 'Engine error 500: boom' })
  })

  it('still throws when the engine cannot be reached, which is not a refusal', async () => {
    await expect(runPromote(refusingEngine(new EngineOfflineError('http://engine'), PROMOTES), reply())).rejects.toBeInstanceOf(EngineOfflineError)
  })

  it('asks nothing of an engine that says it cannot promote, and says so', async () => {
    const engine = refusingEngine(new Error('never called'), { nodePromote: false })
    expect(await runPromote(engine, reply())).toEqual({ kind: 'refused', said: UNSUPPORTED_PROMOTE, unsupported: true })
  })

  it('reads a 404 from an engine too old to say as the endpoint missing, since the node came from the run', async () => {
    const engine = refusingEngine(new EngineHttpError(404, 'http://engine/promote', 'Not Found'), {})
    expect(await runPromote(engine, reply())).toEqual({ kind: 'refused', said: UNSUPPORTED_PROMOTE, unsupported: true })
  })

  it('still asks an engine too old to say, which may have the endpoint all the same', async () => {
    expect(await runPromote(streamingEngine([{ type: 'run_start', runId: RUN }], {}), reply())).toMatchObject({ kind: 'landed' })
  })
})
