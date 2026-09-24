import { describe, it, expect } from 'vitest'
import { resumeRequest as requestFor, runResume, UNSUPPORTED_RESUME, type ResumeSource } from '@/run/resume'
import { directionLines } from '@/run/holdNote'
import { EngineHttpError, EngineOfflineError } from '@/engine/transport'
import { refusingEngine, streamingEngine } from './stubEngine'
import type { HoldPick } from '@/run/holdNote'
import type { Capabilities, RunEvent } from '@/engine/types'

/**
 * Resume's call, apart from the vault: what it asks the engine for, what it
 * reads back out of the run stream, and what it says to each refusal.
 */

const RESUMES: Capabilities = { runResume: true }

const DIRECTION = 'KEEP:\nCHANGE: faster combat\nKILL:\nCANON?\n- [x] halo = burden — character-director\n'

function hold(nodeId: string, headings: string[], chosen?: string): HoldPick {
  return {
    nodeId,
    candidates: headings.map(heading => ({ heading, body: 'words', ticked: heading === chosen })),
    ...(chosen ? { chosen } : {}),
  }
}

/** The request for a note's source, with what the human wrote read out of its Direction as the hold module reads it. */
const resumeRequest = (source: Omit<ResumeSource, 'said'>) => requestFor({ ...source, said: directionLines(source.direction) })

describe('resumeRequest', () => {
  it('sends the Direction block verbatim, which the engine refuses blank', () => {
    expect(resumeRequest({ direction: DIRECTION, holds: [] })).toMatchObject({ direction: DIRECTION })
  })

  it('sends a ticked candidate as chosen, by its heading', () => {
    const request = resumeRequest({ direction: DIRECTION, holds: [hold('decider', ['Candidate 1', 'Candidate 2'], 'Candidate 2')] })
    expect(request.chosen).toBe('Candidate 2')
  })

  it('sends the revision the chosen candidate came from', () => {
    const request = resumeRequest({
      direction: DIRECTION,
      holds: [{ ...hold('decider', ['Candidate 1'], 'Candidate 1'), revision: 4 }],
    })
    expect(request).toMatchObject({ chosen: 'Candidate 1', revision: 4 })
  })

  it('never sends both picks, since the engine refuses a request carrying the two', () => {
    const request = resumeRequest({ direction: DIRECTION, holds: [hold('decider', ['Candidate 1'], 'Candidate 1')] })
    expect(request.custom).toBeUndefined()
  })

  it('sends what the human wrote as custom when candidates were offered and none ticked', () => {
    const request = resumeRequest({ direction: DIRECTION, holds: [hold('decider', ['Candidate 1', 'Candidate 2'])] })
    expect(request.custom).toBe('CHANGE: faster combat')
    expect(request.chosen).toBeUndefined()
  })

  it('sends no custom when the human wrote nothing under the verb template', () => {
    const request = resumeRequest({ direction: 'KEEP:\nCHANGE:\n', holds: [hold('decider', ['Candidate 1'])] })
    expect(request.custom).toBeUndefined()
  })

  it('answers a hold that offered no candidates with the human own words too', () => {
    const request = resumeRequest({ direction: DIRECTION, holds: [hold('decider', [])] })
    expect(request.custom).toBe('CHANGE: faster combat')
    expect(request.chosen).toBeUndefined()
  })

  it('sends no pick at all for a run the note shows waiting at nothing', () => {
    const request = resumeRequest({ direction: DIRECTION, holds: [] })
    expect(request.chosen).toBeUndefined()
    expect(request.custom).toBeUndefined()
  })

  it('names no hold when only one is open — the engine resumes its own', () => {
    expect(resumeRequest({ direction: DIRECTION, holds: [hold('decider', ['Candidate 1'])] }).holdId).toBeUndefined()
  })

  it('names the ticked hold by its node id when several are open', () => {
    const holds = [hold('first', ['Candidate 1']), hold('second', ['Candidate 1'], 'Candidate 1')]
    expect(resumeRequest({ direction: DIRECTION, holds }).holdId).toBe('second')
  })

  it('names the last open hold, the engine own, when several are open and none is ticked', () => {
    const holds = [hold('first', ['Candidate 1']), hold('second', ['Candidate 1'])]
    expect(resumeRequest({ direction: DIRECTION, holds }).holdId).toBe('second')
  })

  it('sends canon as context under the chain context-node key, when there is one', () => {
    expect(resumeRequest({ direction: DIRECTION, holds: [], canon: '## LOCKED\n- halo = burden\n' })).toMatchObject({
      context: { 'canon-anime-game': '## LOCKED\n- halo = burden\n' },
    })
  })

  it('sends no context at all when there is no canon file yet', () => {
    expect(resumeRequest({ direction: DIRECTION, holds: [] })).not.toHaveProperty('context')
  })
})

describe('runResume', () => {
  const request = { direction: DIRECTION }

  it('reports the run id the stream names up front', async () => {
    const engine = streamingEngine([{ type: 'run_start', runId: '2026-09-15-Ab3dE1' }], RESUMES)
    expect(await runResume(engine, '2026-09-15-Ab3dE1', request)).toEqual({ kind: 'landed', runId: '2026-09-15-Ab3dE1', forked: false })
  })

  it('takes the run id from the stream, not the run it was posted to, so a fork is followed', async () => {
    const engine = streamingEngine([
      { type: 'run_start', runId: '2026-09-20-Forked' },
      { type: 'run_complete', runId: '2026-09-20-Forked' },
    ], RESUMES)
    expect(await runResume(engine, '2026-09-15-Ab3dE1', request)).toEqual({ kind: 'landed', runId: '2026-09-20-Forked', forked: true })
  })

  it('reads the run event set, so a hold the continued run reaches names its run', async () => {
    const waiting: RunEvent = {
      type: 'run_waiting',
      runId: '2026-09-15-Ab3dE1',
      nodeId: 'decider',
      hold: { nodeId: 'decider', input: '', candidates: [], reachedAt: '' },
    }
    expect(await runResume(streamingEngine([waiting], RESUMES), '2026-09-15-Ab3dE1', request)).toEqual({
      kind: 'landed',
      runId: '2026-09-15-Ab3dE1',
      forked: false,
    })
  })

  it('carries the run id alongside a failure the run hit partway through', async () => {
    const engine = streamingEngine([
      { type: 'run_start', runId: '2026-09-15-Ab3dE1' },
      { type: 'error', error: 'the model refused' },
    ], RESUMES)
    expect(await runResume(engine, '2026-09-15-Ab3dE1', request)).toEqual({
      kind: 'landed',
      runId: '2026-09-15-Ab3dE1',
      error: 'the model refused',
      forked: false,
    })
  })

  it('answers with no run id at all when the stream never named one', async () => {
    const engine = streamingEngine([{ type: 'error', error: 'nothing to resume' }], RESUMES)
    expect(await runResume(engine, '2026-09-15-Ab3dE1', request)).toEqual({ kind: 'landed', error: 'nothing to resume', forked: false })
  })

  it('says a still-running run cannot be resumed yet, rather than throwing', async () => {
    const engine = refusingEngine(new EngineHttpError(409, '/resume', '{"error":"run is running"}'), RESUMES)
    expect(await runResume(engine, '2026-09-15-Ab3dE1', request)).toEqual({
      kind: 'refused',
      said: 'This run cannot be resumed yet: run is running',
    })
  })

  it('notifies the caller of a 409 so it can reload the hold without retrying the old pick', async () => {
    const engine = refusingEngine(
      new EngineHttpError(409, '/resume', '{"error":"Candidates of hold decider are at revision 3, not 1"}'),
      RESUMES,
    )
    let conflicted = false
    const result = await runResume(engine, '2026-09-15-Ab3dE1', { direction: DIRECTION, chosen: 'Candidate 1', revision: 1 }, undefined, () => (conflicted = true))
    expect(result).toMatchObject({ kind: 'refused' })
    expect(conflicted).toBe(true)
  })

  it('falls back to the status when a 409 carries no reason', async () => {
    const engine = refusingEngine(new EngineHttpError(409, '/resume', ''), RESUMES)
    expect(await runResume(engine, '2026-09-15-Ab3dE1', request)).toMatchObject({ said: expect.stringContaining('engine error 409') })
  })

  it('says the hold is gone on a 404', async () => {
    const engine = refusingEngine(new EngineHttpError(404, '/resume', 'no such hold'), RESUMES)
    expect(await runResume(engine, '2026-09-15-Ab3dE1', request)).toEqual({
      kind: 'refused',
      said: 'This run no longer has the hold this note answers',
    })
  })

  it('passes the engine own reason on for a 400 — a bad pick, both picks, a blank direction', async () => {
    const engine = refusingEngine(new EngineHttpError(400, '/resume', '{"error":"chosen and custom are exclusive"}'), RESUMES)
    expect(await runResume(engine, '2026-09-15-Ab3dE1', request)).toEqual({
      kind: 'refused',
      said: 'The engine would not resume this run: chosen and custom are exclusive',
    })
  })

  it('leaves an unreachable engine to the guard, which is not the hold business', async () => {
    const engine = refusingEngine(new EngineOfflineError('http://engine', new Error('boom')), RESUMES)
    await expect(runResume(engine, '2026-09-15-Ab3dE1', request)).rejects.toBeInstanceOf(EngineOfflineError)
  })

  it('asks nothing of an engine that says it cannot resume, and says so', async () => {
    const engine = refusingEngine(new Error('never called'), { runResume: false })
    expect(await runResume(engine, '2026-09-15-Ab3dE1', request)).toEqual({ kind: 'refused', said: UNSUPPORTED_RESUME, unsupported: true })
  })

  it('on a 404 from an engine too old to say, allows that the endpoint may be what is missing', async () => {
    const engine = refusingEngine(new EngineHttpError(404, '/resume', 'Not Found'), {})
    expect(await runResume(engine, '2026-09-15-Ab3dE1', request)).toEqual({
      kind: 'refused',
      said: 'This run no longer has the hold this note answers — or this engine cannot resume a hold. Update maestro-playground if so.',
    })
  })

  it('still asks an engine too old to say, which may have the endpoint all the same', async () => {
    const engine = streamingEngine([{ type: 'run_start', runId: '2026-09-15-Ab3dE1' }], {})
    expect(await runResume(engine, '2026-09-15-Ab3dE1', request)).toMatchObject({ kind: 'landed' })
  })
})
