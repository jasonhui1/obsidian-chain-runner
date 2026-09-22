import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { EngineHttpError } from '@/engine/transport'
import type { HoldRecord, RunEvent, ResumeRequest } from '@/engine/types'
import { runResume } from '@/run/resume'
import { runReroll, UNSUPPORTED_REROLL } from '@/run/reroll'
import { refusingEngine, stubEngine } from './stubEngine'

const CONTRACTS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'contracts')

function json<T>(path: string): T {
  return JSON.parse(readFileSync(join(CONTRACTS, path), 'utf8')) as T
}

function events(path: string): RunEvent[] {
  return readFileSync(join(CONTRACTS, path), 'utf8')
    .split(/\r?\n/)
    .filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice('data: '.length)) as RunEvent)
}

describe('runReroll', () => {
  it('uses the recorded revision and returns the final replacement hold', async () => {
    const run = json<{ runId: string; holds: HoldRecord[] }>('reroll/run.json')
    const hold = run.holds[0]!
    const request = json<{ revision: number }>('reroll/request.json')
    const calls: unknown[] = []
    const engine = stubEngine({
      capabilities: () => Promise.resolve({ holdReroll: true }),
      rerollHold: async function* (runId: string, holdId: string, revision: number) {
        calls.push({ runId, holdId, revision })
        yield* events('reroll/stream.sse')
      },
    })

    const answer = await runReroll(engine, run.runId, hold.nodeId, request.revision)
    expect(calls).toEqual([{ runId: run.runId, holdId: hold.nodeId, revision: request.revision }])
    expect(answer).toMatchObject({ kind: 'landed', runId: run.runId, hold: { revision: 3, feedback: 'Less tragic, but keep a real consequence' } })
  })

  it('surfaces reroll_failed while the final hold retains the prior candidates', async () => {
    const run = json<{ runId: string; holds: HoldRecord[] }>('reroll-failed/run.json')
    const original = json<{ holds: HoldRecord[] }>('hold/run.json').holds[0]!
    const hold = run.holds[0]!
    const request = json<{ revision: number }>('reroll-failed/request.json')
    const engine = stubEngine({
      capabilities: () => Promise.resolve({ holdReroll: true }),
      rerollHold: async function* () {
        yield* events('reroll-failed/stream.sse')
      },
    })

    const answer = await runReroll(engine, run.runId, hold.nodeId, request.revision)
    expect(answer).toMatchObject({
      kind: 'landed',
      error: 'Reroll produced no `## Candidate N` sections; the earlier candidates stay',
      hold: { candidates: original.candidates, feedback: 'Kinder still' },
    })
  })

  it('reports the contract stale revision refusal and the resume caller can reload without retrying', async () => {
    const request = json<ResumeRequest>('reroll/refusal-request.json')
    const error = readFileSync(join(CONTRACTS, 'reroll/refusal-response.json'), 'utf8')
    const engine = refusingEngine(new EngineHttpError(409, '/resume', error), { runResume: true })
    let stale = false

    const answer = await runResume(engine, 'contract-run-reroll', request, undefined, () => (stale = true))
    expect(answer).toMatchObject({ kind: 'refused', said: expect.stringContaining('revision 3') })
    expect(stale).toBe(true)
  })

  it('does not call the reroll route on an engine that has not advertised it', async () => {
    let called = false
    const engine = stubEngine({
      capabilities: () => Promise.resolve({}),
      rerollHold: async function* () {
        called = true
      },
    })
    const answer = await runReroll(engine, 'contract-run-reroll', 'hold', 1)
    expect(answer).toMatchObject({ kind: 'refused', said: UNSUPPORTED_REROLL, unsupported: true })
    expect(called).toBe(false)
  })
})
