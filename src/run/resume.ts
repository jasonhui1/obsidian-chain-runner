import { CANON_CONTEXT_KEY } from './canon'
import { underRunOfRecord, type ForkedRun } from './fork'
import { streamOrRefusal } from './headlessRun'
import { directionLines, type HoldPick } from './holdNote'
import { disclaims, mayLackRoute } from '../engine/capabilities'
import { engineSaid } from '../engine/guard'
import type { EngineHttpError } from '../engine/transport'
import type { EngineClient } from '../engine/client'
import type { Capabilities, ResumeRequest } from '../engine/types'

/**
 * Resume: the hold's answer posted back to the run, which carries on from
 * there. The note it is read out of is `./holdNote.ts`; this is only the call.
 */

export const UNSUPPORTED_RESUME = 'This engine cannot resume a hold. Update maestro-playground.'

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

/** What a resume came back with: the run it carried on as — which may be a fork — or why the engine would not. */
export type ResumeOutcome = ForkedRun

/**
 * The hold answered and the run carried on, read as a run stream under whichever
 * run the stream names — a hold already answered forks instead (#53). Every
 * refusal comes back as words to show; only an unreachable engine still throws.
 */
export async function runResume(engine: EngineClient, capabilities: Capabilities, runId: string, request: ResumeRequest): Promise<ResumeOutcome> {
  if (disclaims(capabilities, 'runResume')) return { kind: 'refused', said: UNSUPPORTED_RESUME }
  const said = (error: EngineHttpError): string | undefined => refusal(error, runId, capabilities)
  return underRunOfRecord(runId, onEvent => streamOrRefusal(() => engine.resumeRun(runId, request), said, onEvent))
}

function refusal(error: EngineHttpError, runId: string, capabilities: Capabilities): string | undefined {
  if (error.status === 409) return `Run ${runId} cannot be resumed yet: ${engineSaid(error)}`
  const gone = `Run ${runId} no longer has the hold this note answers`
  // The run id is the note's own, so either the run or the route may be what is missing.
  if (mayLackRoute(error, capabilities, 'runResume')) return `${gone} — or this engine cannot resume a hold. Update maestro-playground if so.`
  if (error.status === 404) return gone
  if (error.status === 400) return `The engine would not resume run ${runId}: ${engineSaid(error)}`
  return undefined
}
