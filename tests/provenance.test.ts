import { describe, it, expect } from 'vitest'
import {
  resolveSourceRun,
  runViewUrl,
  sourceRunId,
  sourceRunLabel,
  SOURCE_RUN,
  SOURCE_RUN_DELETED,
  type RunExistence,
} from '@/run/provenance'

/**
 * Where an output note says it came from. Nothing here reaches an engine: the
 * existence question is asked through `exists`.
 */

const engineUrl = 'http://localhost:3000'

const answering =
  (answer: RunExistence) =>
  (): Promise<RunExistence> =>
    Promise.resolve(answer)

const refusing = (): Promise<RunExistence> => Promise.reject(new Error('the engine blew up'))

describe('sourceRunId', () => {
  it('reads the run an output note was written by', () => {
    expect(sourceRunId({ run: '2026-09-02-ab12c', chain: 'Relay', output: 'Survivor' })).toBe('2026-09-02-ab12c')
  })

  it('is undefined for a note that is not an output note', () => {
    expect(sourceRunId({ run: '2026-09-02-ab12c' })).toBeUndefined()
    expect(sourceRunId({ title: 'a premise' })).toBeUndefined()
    expect(sourceRunId(undefined)).toBeUndefined()
    expect(sourceRunId({ run: '', output: 'Survivor' })).toBeUndefined()
  })
})

describe('runViewUrl', () => {
  it('is the engine’s result view for the run', () => {
    expect(runViewUrl(engineUrl, '2026-09-02-ab12c')).toBe('http://localhost:3000/runs/2026-09-02-ab12c')
  })

  it('escapes a run id that would otherwise reshape the path', () => {
    expect(runViewUrl(engineUrl, 'a/../b')).toBe('http://localhost:3000/runs/a%2F..%2Fb')
  })

  it('is undefined when the engine URL will not parse, rather than throwing', () => {
    expect(runViewUrl('not a url', 'r1')).toBeUndefined()
  })
})

describe('resolveSourceRun', () => {
  it('links to the run the engine still holds', async () => {
    const source = await resolveSourceRun({ runId: 'r1', engineUrl, exists: answering('found') })
    expect(source).toEqual({ kind: 'run', runId: 'r1', url: 'http://localhost:3000/runs/r1' })
    expect(sourceRunLabel(source)).toBe(SOURCE_RUN)
  })

  it('says the run is gone when the engine says it has no such run', async () => {
    const source = await resolveSourceRun({ runId: 'r1', engineUrl, exists: answering('missing') })
    expect(source).toEqual({ kind: 'deleted', runId: 'r1' })
    expect(sourceRunLabel(source)).toBe(SOURCE_RUN_DELETED)
  })

  it('still links when the engine could not be asked — offline is not deleted', async () => {
    const source = await resolveSourceRun({ runId: 'r1', engineUrl, exists: answering('unknown') })
    expect(source).toEqual({ kind: 'run', runId: 'r1', url: 'http://localhost:3000/runs/r1' })
  })

  it('treats a thrown answer as unasked rather than failing the render', async () => {
    await expect(resolveSourceRun({ runId: 'r1', engineUrl, exists: refusing })).resolves.toEqual({
      kind: 'run',
      runId: 'r1',
      url: 'http://localhost:3000/runs/r1',
    })
  })

  it('names the run with no link when the engine URL will not parse', async () => {
    const source = await resolveSourceRun({ runId: 'r1', engineUrl: 'not a url', exists: answering('found') })
    expect(source).toEqual({ kind: 'run', runId: 'r1' })
  })
})
