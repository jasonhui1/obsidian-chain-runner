import { CANON_CONTEXT_KEY } from './canon'
import { drainRun, type RunOutcome } from './headlessRun'
import { directionLines, type HoldPick } from './holdNote'
import { engineFailureMessage, engineSaid } from '../engine/guard'
import { EngineHttpError } from '../engine/transport'
import type { EngineClient } from '../engine/client'
import type { ResumeRequest } from '../engine/types'

/**
 * Resume: the hold's answer posted back to the run, which carries on from
 * there. The note it is read out of is `./holdNote.ts`; this is only the call.
 */

/** What the note offers a resume: its Direction, the holds it shows open, and canon as it stands. */
export interface ResumeSource {
  direction: string
  holds: readonly HoldPick[]
  canon?: string
}

/**
 * The hold a resume answers: the one with a candidate ticked, or else the last
 * open one — which is the engine's own open hold. A note showing none leaves
 * the engine to pick, and to fork when what it picks is already answered (#53).
 */
function answeredHold(holds: readonly HoldPick[]): HoldPick | undefined {
  return holds.find(hold => hold.chosen) ?? holds[holds.length - 1]
}

/**
 * What the engine is asked to resume with. A ticked candidate goes as `chosen`;
 * a hold left unticked is answered by the human's own words as `custom`. Never
 * both — the engine refuses a request carrying the two.
 */
export function resumeRequest(source: ResumeSource): ResumeRequest {
  const hold = answeredHold(source.holds)
  const own = hold && !hold.chosen ? directionLines(source.direction).join('\n') : ''
  return {
    direction: source.direction,
    ...(hold?.chosen ? { chosen: hold.chosen } : {}),
    ...(own ? { custom: own } : {}),
    // One open hold needs no naming; with several, the engine would answer its
    // own last one rather than the one the human ticked.
    ...(hold && source.holds.length > 1 ? { holdId: hold.nodeId } : {}),
    ...(source.canon !== undefined ? { context: { [CANON_CONTEXT_KEY]: source.canon } } : {}),
  }
}

/** What a resume came back with: the run it carried on as, or why the engine would not. */
export type ResumeOutcome = { kind: 'ran'; outcome: RunOutcome } | { kind: 'refused'; said: string }

/**
 * The hold answered and the run carried on, read as a run stream. Every refusal
 * comes back as words to show; only an unreachable engine still throws.
 */
export async function runResume(engine: EngineClient, runId: string, request: ResumeRequest): Promise<ResumeOutcome> {
  try {
    return { kind: 'ran', outcome: await drainRun(engine.resumeRun(runId, request)) }
  } catch (error) {
    if (!(error instanceof EngineHttpError)) throw error
    return { kind: 'refused', said: refusal(error, runId) }
  }
}

function refusal(error: EngineHttpError, runId: string): string {
  if (error.status === 409) return `Run ${runId} cannot be resumed yet: ${engineSaid(error)}`
  if (error.status === 404) return `Run ${runId} no longer has the hold this note answers`
  if (error.status === 400) return `The engine would not resume run ${runId}: ${engineSaid(error)}`
  return engineFailureMessage(error) ?? `Resume of run ${runId} failed`
}
