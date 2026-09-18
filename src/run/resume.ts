import { answer, type Answer, type OnEvent } from './answer'
import { CANON_CONTEXT_KEY } from './canon'
import { directionLines, type HoldPick } from './holdNote'
import type { EngineClient } from '../engine/client'
import type { ResumeRequest } from '../engine/types'

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

/**
 * The hold answered and the run carried on, under whichever run the stream
 * names — a hold already answered forks instead (#53). Every refusal comes
 * back as words to show; only an unreachable engine still throws.
 */
export function runResume(engine: EngineClient, runId: string, request: ResumeRequest, onEvent?: OnEvent): Promise<Answer> {
  const gone = `Run ${runId} no longer has the hold this note answers`
  return answer(engine, {
    open: () => engine.resumeRun(runId, request),
    calledOn: runId,
    onEvent,
    refusals: {
      endpoint: 'runResume',
      unsupported: UNSUPPORTED_RESUME,
      // The run id is the note's own, so either the run or the route may be what is missing.
      missingRoute: `${gone} — or this engine cannot resume a hold. Update maestro-playground if so.`,
      running: said => `Run ${runId} cannot be resumed yet: ${said}`,
      gone,
      invalid: said => `The engine would not resume run ${runId}: ${said}`,
    },
  })
}
