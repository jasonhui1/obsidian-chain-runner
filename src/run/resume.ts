import { CANON_CONTEXT_KEY } from './canon'
import { runHeadless, type RunOutcome } from './headlessRun'
import type { EngineClient } from '../engine/client'
import type { RunRequest } from '../engine/types'

/**
 * Resume: a hold note's Direction block, run as `develop-direction`. The note
 * itself is `./holdNote.ts`; this is only the run.
 */

const DEVELOP_DIRECTION = 'develop-direction'

export function resumeRequest(direction: string, canon: string | undefined): RunRequest {
  return {
    chainName: DEVELOP_DIRECTION,
    seedPrompt: direction,
    ...(canon !== undefined ? { context: { [CANON_CONTEXT_KEY]: canon } } : {}),
  }
}

/** Runs `develop-direction` to completion and reports what it landed on. */
export function runResume(engine: EngineClient, direction: string, canon: string | undefined): Promise<RunOutcome> {
  return runHeadless(engine, resumeRequest(direction, canon))
}
