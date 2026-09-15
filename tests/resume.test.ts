import { describe, it, expect } from 'vitest'
import { greenlightPitch, resumeRequest, runResume } from '@/run/resume'
import type { EngineClient } from '@/engine/client'
import type { AgentOutput, RunEvent } from '@/engine/types'

/**
 * Resume's run, apart from the vault: what it asks the engine for, and what it
 * reads back out of the stream.
 */

function stubEngine(events: RunEvent[]): EngineClient {
  return {
    launchRun: async function* () {
      for (const event of events) yield event
    },
  } as unknown as EngineClient
}

describe('resumeRequest', () => {
  it('runs develop-direction with the Direction block as the seed', () => {
    expect(resumeRequest('KEEP: fast combat', undefined)).toMatchObject({
      chainName: 'develop-direction',
      seedPrompt: 'KEEP: fast combat',
    })
  })

  it('sends canon as context under the chain’s context-node key, when there is one', () => {
    expect(resumeRequest('KEEP: fast combat', '## LOCKED\n- halo = burden\n')).toMatchObject({
      context: { 'canon-anime-game': '## LOCKED\n- halo = burden\n' },
    })
  })

  it('sends no context at all when there is no canon file yet', () => {
    expect(resumeRequest('KEEP: fast combat', undefined)).not.toHaveProperty('context')
  })
})

describe('runResume', () => {
  it('reports the run id the engine names up front', async () => {
    const engine = stubEngine([{ type: 'run_start', runId: '2026-09-15-Ab3dE1' }])
    expect(await runResume(engine, 'KEEP: fast combat', undefined)).toEqual({ runId: '2026-09-15-Ab3dE1' })
  })

  it('keeps the run id a later event confirms', async () => {
    const engine = stubEngine([
      { type: 'run_start', runId: '2026-09-15-Ab3dE1' },
      { type: 'run_complete', runId: '2026-09-15-Ab3dE1' },
    ])
    expect(await runResume(engine, 'KEEP: fast combat', undefined)).toEqual({ runId: '2026-09-15-Ab3dE1' })
  })

  it('carries the run id alongside a failure the chain hit partway through', async () => {
    const engine = stubEngine([
      { type: 'run_start', runId: '2026-09-15-Ab3dE1' },
      { type: 'error', error: 'the model refused' },
    ])
    expect(await runResume(engine, 'KEEP: fast combat', undefined)).toEqual({
      runId: '2026-09-15-Ab3dE1',
      error: 'the model refused',
    })
  })

  it('answers with no run id at all when the engine never named one', async () => {
    const engine = stubEngine([{ type: 'error', error: 'no such chain' }])
    expect(await runResume(engine, 'KEEP: fast combat', undefined)).toEqual({ error: 'no such chain' })
  })
})

describe('greenlightPitch', () => {
  const output = (text: string): AgentOutput => ({ agentName: 'greenlight', output: text, status: 'success', timestamp: '' })

  it('takes the Greenlight Pitch section out of the run’s last output', () => {
    const pitch = greenlightPitch([
      output('## Notes\nEarlier thinking.'),
      output('## Risks\nToo much Nier.\n\n## Greenlight Pitch\nA combat trial in a void.\n\n## Next\nBuild it.'),
    ])
    expect(pitch).toBe('A combat trial in a void.')
  })

  it('reaches back to an earlier output when the last one pitches nothing', () => {
    const pitch = greenlightPitch([output('## Greenlight Pitch\nA combat trial.'), output('## Risks\nNone.')])
    expect(pitch).toBe('A combat trial.')
  })

  it('calls nothing a pitch when no output names that section', () => {
    expect(greenlightPitch([output('Just some words.')])).toBeUndefined()
  })

  it('has no pitch for a run that wrote nothing', () => {
    expect(greenlightPitch([])).toBeUndefined()
  })
})
