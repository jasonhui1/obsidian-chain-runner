import { describe, it, expect } from 'vitest'
import { underRunOfRecord } from '@/run/fork'
import { launch, type Answer } from '@/run/answer'
import type { RunEvent } from '@/engine/types'
import { streamingEngine } from './stubEngine'

/**
 * The one reader of a forking stream, which both resume and promote go through:
 * which run the stream turned out to be, and whether that is a fork.
 */

const CALLED = '2026-09-15-Ab3dE1'
const FORK = '2026-09-20-Forked'

/** A stream of `events`, read the way every run stream is. */
function streaming(events: RunEvent[]): Parameters<typeof underRunOfRecord>[1] {
  return onEvent => launch(streamingEngine(events), { seedPrompt: '' }, onEvent)
}

describe('underRunOfRecord', () => {
  it('stays on the run it was called on when the stream names that one', async () => {
    const events: RunEvent[] = [
      { type: 'run_start', runId: CALLED },
      { type: 'run_complete', runId: CALLED },
    ]
    expect(await underRunOfRecord(CALLED, streaming(events))).toEqual({ kind: 'landed', runId: CALLED, forked: false })
  })

  it('takes the fork’s id as the run of record when the stream names another run', async () => {
    const events: RunEvent[] = [
      { type: 'run_start', runId: FORK },
      { type: 'run_complete', runId: FORK },
    ]
    expect(await underRunOfRecord(CALLED, streaming(events))).toEqual({ kind: 'landed', runId: FORK, forked: true })
  })

  it('keeps the first run_start’s id, even where a later event names another run', async () => {
    const events: RunEvent[] = [
      { type: 'run_start', runId: FORK },
      { type: 'run_complete', runId: CALLED },
    ]
    expect(await underRunOfRecord(CALLED, streaming(events))).toMatchObject({ runId: FORK, forked: true })
  })

  it('carries a failure the forked run hit along with the fork’s id', async () => {
    const events: RunEvent[] = [
      { type: 'run_start', runId: FORK },
      { type: 'error', error: 'the model refused' },
    ]
    expect(await underRunOfRecord(CALLED, streaming(events))).toEqual({
      kind: 'landed',
      runId: FORK,
      error: 'the model refused',
      forked: true,
    })
  })

  it('leaves a stream that named no run at all without one, and calls it no fork', async () => {
    const events: RunEvent[] = [{ type: 'error', error: 'nothing to resume' }]
    expect(await underRunOfRecord(CALLED, streaming(events))).toEqual({ kind: 'landed', error: 'nothing to resume', forked: false })
  })

  it('hears every event on the way, so a panel can draw what the fork is writing', async () => {
    const heard: string[] = []
    const events: RunEvent[] = [
      { type: 'run_start', runId: FORK },
      { type: 'run_complete', runId: FORK },
    ]
    await underRunOfRecord(CALLED, streaming(events), event => {
      heard.push(event.type)
    })
    expect(heard).toEqual(['run_start', 'run_complete'])
  })

  it('passes a refusal straight through: nothing streamed, so nothing forked', async () => {
    const refused: Answer = { kind: 'refused', said: 'Run is still running' }
    expect(await underRunOfRecord(CALLED, async () => refused)).toEqual(refused)
  })
})
