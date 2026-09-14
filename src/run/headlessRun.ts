import type { EngineClient } from '../engine/client'
import { isEvent, type RunRequest } from '../engine/types'

/** A run nothing draws while it goes — only the id it lands on matters. */

export interface RunOutcome {
  /** Set as soon as the engine names the run; a run that fails still gets one. */
  runId?: string
  error?: string
}

/** Runs a request to completion and reports what it landed on. */
export async function runHeadless(engine: EngineClient, request: RunRequest): Promise<RunOutcome> {
  let outcome: RunOutcome = {}
  for await (const event of engine.launchRun(request)) {
    if (isEvent(event, 'run_start') || isEvent(event, 'run_complete')) outcome = { ...outcome, runId: event.runId }
    if (isEvent(event, 'error')) outcome = { ...outcome, error: event.error }
  }
  return outcome
}
