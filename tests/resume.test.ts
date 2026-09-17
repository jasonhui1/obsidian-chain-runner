import { describe, it, expect } from 'vitest'
import { resumeRequest, runResume } from '@/run/resume'
import type { EngineClient } from '@/engine/client'
import { EngineHttpError, EngineOfflineError } from '@/engine/transport'
import type { HoldPick } from '@/run/holdNote'
import type { RunEvent } from '@/engine/types'

/**
 * Resume's call, apart from the vault: what it asks the engine for, what it
 * reads back out of the run stream, and what it says to each refusal.
 */

const DIRECTION = 'KEEP:\nCHANGE: faster combat\nKILL:\nCANON?\n- [x] halo = burden — character-director\n'

function hold(nodeId: string, headings: string[], chosen?: string): HoldPick {
  return {
    nodeId,
    candidates: headings.map(heading => ({ heading, body: 'words', ticked: heading === chosen })),
    ...(chosen ? { chosen } : {}),
  }
}

function stubEngine(events: RunEvent[]): EngineClient {
  return {
    resumeRun: async function* () {
      for (const event of events) yield event
    },
  } as unknown as EngineClient
}

function refusingEngine(thrown: unknown): EngineClient {
  return {
    resumeRun: function () {
      throw thrown
    },
  } as unknown as EngineClient
}

describe('resumeRequest', () => {
  it('sends the Direction block verbatim, which the engine refuses blank', () => {
    expect(resumeRequest({ direction: DIRECTION, holds: [] })).toMatchObject({ direction: DIRECTION })
  })

  it('sends a ticked candidate as chosen, by its heading', () => {
    const request = resumeRequest({ direction: DIRECTION, holds: [hold('decider', ['Candidate 1', 'Candidate 2'], 'Candidate 2')] })
    expect(request.chosen).toBe('Candidate 2')
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
    const engine = stubEngine([{ type: 'run_start', runId: '2026-09-15-Ab3dE1' }])
    expect(await runResume(engine, '2026-09-15-Ab3dE1', request)).toEqual({ kind: 'ran', outcome: { runId: '2026-09-15-Ab3dE1' }, forked: false })
  })

  it('takes the run id from the stream, not the run it was posted to, so a fork is followed', async () => {
    const engine = stubEngine([
      { type: 'run_start', runId: '2026-09-20-Forked' },
      { type: 'run_complete', runId: '2026-09-20-Forked' },
    ])
    expect(await runResume(engine, '2026-09-15-Ab3dE1', request)).toEqual({ kind: 'ran', outcome: { runId: '2026-09-20-Forked' }, forked: true })
  })

  it('reads the run event set, so a hold the continued run reaches names its run', async () => {
    const waiting: RunEvent = {
      type: 'run_waiting',
      runId: '2026-09-15-Ab3dE1',
      nodeId: 'decider',
      hold: { nodeId: 'decider', input: '', candidates: [], reachedAt: '' },
    }
    expect(await runResume(stubEngine([waiting]), '2026-09-15-Ab3dE1', request)).toEqual({
      kind: 'ran',
      outcome: { runId: '2026-09-15-Ab3dE1' },
      forked: false,
    })
  })

  it('carries the run id alongside a failure the run hit partway through', async () => {
    const engine = stubEngine([
      { type: 'run_start', runId: '2026-09-15-Ab3dE1' },
      { type: 'error', error: 'the model refused' },
    ])
    expect(await runResume(engine, '2026-09-15-Ab3dE1', request)).toEqual({
      kind: 'ran',
      outcome: { runId: '2026-09-15-Ab3dE1', error: 'the model refused' },
      forked: false,
    })
  })

  it('answers with no run id at all when the stream never named one', async () => {
    const engine = stubEngine([{ type: 'error', error: 'nothing to resume' }])
    expect(await runResume(engine, '2026-09-15-Ab3dE1', request)).toEqual({ kind: 'ran', outcome: { error: 'nothing to resume' }, forked: false })
  })

  it('says a still-running run cannot be resumed yet, rather than throwing', async () => {
    const engine = refusingEngine(new EngineHttpError(409, '/resume', '{"error":"run is running"}'))
    expect(await runResume(engine, '2026-09-15-Ab3dE1', request)).toEqual({
      kind: 'refused',
      said: 'Run 2026-09-15-Ab3dE1 cannot be resumed yet: run is running',
    })
  })

  it('falls back to the status when a 409 carries no reason', async () => {
    const engine = refusingEngine(new EngineHttpError(409, '/resume', ''))
    expect(await runResume(engine, '2026-09-15-Ab3dE1', request)).toMatchObject({ said: expect.stringContaining('engine error 409') })
  })

  it('says the hold is gone on a 404', async () => {
    const engine = refusingEngine(new EngineHttpError(404, '/resume', 'no such hold'))
    expect(await runResume(engine, '2026-09-15-Ab3dE1', request)).toEqual({
      kind: 'refused',
      said: 'Run 2026-09-15-Ab3dE1 no longer has the hold this note answers',
    })
  })

  it('passes the engine own reason on for a 400 — a bad pick, both picks, a blank direction', async () => {
    const engine = refusingEngine(new EngineHttpError(400, '/resume', '{"error":"chosen and custom are exclusive"}'))
    expect(await runResume(engine, '2026-09-15-Ab3dE1', request)).toEqual({
      kind: 'refused',
      said: 'The engine would not resume run 2026-09-15-Ab3dE1: chosen and custom are exclusive',
    })
  })

  it('leaves an unreachable engine to the guard, which is not the hold business', async () => {
    const engine = refusingEngine(new EngineOfflineError('http://engine', new Error('boom')))
    await expect(runResume(engine, '2026-09-15-Ab3dE1', request)).rejects.toBeInstanceOf(EngineOfflineError)
  })
})
