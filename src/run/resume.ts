import { CANON_CONTEXT_KEY } from './canon'
import { runHeadless, type RunOutcome } from './headlessRun'
import { extractSection } from './section'
import type { EngineClient } from '../engine/client'
import type { AgentOutput, RunRequest } from '../engine/types'

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

/** The heading `develop-direction` puts its pitch under. */
const PITCH_SECTION = 'Greenlight Pitch'

/**
 * The pitch a resumed run landed on: the Greenlight Pitch section of the last
 * output that has one. A run that pitched nothing has none — whatever else it
 * wrote is not a pitch.
 */
export function greenlightPitch(outputs: AgentOutput[]): string | undefined {
  for (const output of [...outputs].reverse()) {
    const pitch = extractSection(output.output, PITCH_SECTION)
    if (pitch) return pitch
  }
  return undefined
}
