import { CANON_CONTEXT_KEY } from './canon'
import type { EngineClient } from '../engine/client'
import { isEvent, type RunRequest } from '../engine/types'

/**
 * Resume: a hold note's Direction block, run as `develop-direction`. The note
 * itself is `./holdNote.ts`; this is only the run, headless — no panel needs
 * drawing, resume only needs the run id it lands on.
 */

const DEVELOP_DIRECTION = 'develop-direction'

export function resumeRequest(direction: string, canon: string | undefined): RunRequest {
  return {
    chainName: DEVELOP_DIRECTION,
    seedPrompt: direction,
    ...(canon !== undefined ? { context: { [CANON_CONTEXT_KEY]: canon } } : {}),
  }
}

export interface ResumeOutcome {
  /** Set as soon as the engine names the run; a run that fails still gets one. */
  runId?: string
  error?: string
}

/** Runs `develop-direction` to completion and reports what it landed on. */
export async function runResume(
  engine: EngineClient,
  direction: string,
  canon: string | undefined,
): Promise<ResumeOutcome> {
  let outcome: ResumeOutcome = {}
  for await (const event of engine.launchRun(resumeRequest(direction, canon))) {
    if (isEvent(event, 'run_start') || isEvent(event, 'run_complete')) outcome = { ...outcome, runId: event.runId }
    if (isEvent(event, 'error')) outcome = { ...outcome, error: event.error }
  }
  return outcome
}
