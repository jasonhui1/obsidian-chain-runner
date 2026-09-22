import { describe, it, expect } from 'vitest'
import type { EngineClient } from '@/engine/client'
import type { HoldRecord, RunEvent } from '@/engine/types'
import { directionBlock, directionLines, holdNoteContent, tickCandidate, waitingHoldsIn } from '@/run/holdNote'
import { resumeRequest, runResume } from '@/run/resume'

const RUN_ID = 'idea-run'

const ideas: HoldRecord = {
  nodeId: 'hold-idea',
  prompt: 'Which idea should we develop?',
  input: '',
  candidates: [
    { heading: 'Candidate 1', body: 'A quiet journey.' },
    { heading: 'Candidate 2', body: 'A risky rescue.' },
    { heading: 'Candidate 3', body: 'A strange machine.' },
  ],
  reachedAt: 'now',
}

describe('the no-hint idea menu', () => {
  it('shows its three candidates and resumes the same run with the picked idea, then reaches Direction', async () => {
    const note = holdNoteContent({ runId: RUN_ID, chainName: 'creative-director', panels: [], thoughts: {}, holds: [ideas] })
    expect(waitingHoldsIn(note)[0]?.candidates.map(candidate => candidate.heading)).toEqual([
      'Candidate 1',
      'Candidate 2',
      'Candidate 3',
    ])

    const picked = tickCandidate(note, 'hold-idea', 'Candidate 2', true)
    const direction = directionBlock(picked) ?? ''
    const request = resumeRequest({ direction, said: directionLines(direction), holds: waitingHoldsIn(picked) })
    const later: HoldRecord = {
      nodeId: 'hold-direction',
      prompt: 'How should the idea be directed?',
      input: '',
      candidates: [],
      reachedAt: 'later',
    }
    const events: RunEvent[] = [
      { type: 'run_start', runId: RUN_ID },
      { type: 'run_waiting', runId: RUN_ID, nodeId: later.nodeId, hold: later },
    ]
    const calls: { runId: string; request: typeof request }[] = []
    const engine = {
      capabilities: async () => ({ runResume: true }),
      resumeRun: async function* (runId: string, sent: typeof request) {
        calls.push({ runId, request: sent })
        yield* events
      },
    } as unknown as EngineClient

    const answer = await runResume(engine, RUN_ID, request)

    expect(request).toMatchObject({ chosen: 'Candidate 2' })
    expect(request.custom).toBeUndefined()
    expect(request.direction).toBe(direction)
    expect(calls).toEqual([{ runId: RUN_ID, request }])
    expect(answer).toMatchObject({ kind: 'landed', runId: RUN_ID, forked: false })
    expect(events.at(-1)).toMatchObject({ nodeId: 'hold-direction', hold: { nodeId: 'hold-direction', candidates: [] } })
  })
})
