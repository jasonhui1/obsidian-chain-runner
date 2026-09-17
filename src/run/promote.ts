import { CANON_CONTEXT_KEY } from './canon'
import { streamOrRefusal, type StreamedRun } from './headlessRun'
import { engineSaid } from '../engine/guard'
import type { EngineHttpError } from '../engine/transport'
import type { EngineClient } from '../engine/client'
import type { PromoteRequest, RunEvent } from '../engine/types'

/**
 * Promote: a proposer's chat reply made that node's own output. The engine
 * decides what follows — a waiting run reruns to its hold in place, a finished
 * one forks — so this only reads which run the stream names. The `revise` line
 * it answers is read out of the note by `./chat.ts`.
 */

/** Which reply of which node is promoted, and the canon the run carries on under. */
export interface PromotedReply {
  runId: string
  nodeId: string
  /** The proposal's name, which every refusal says. */
  name: string
  /** The 1-based `### Turn N` of the node's log; absent promotes its last reply. */
  turn?: number
  canon?: string
}

/** What the promote is asked for. A context node is read on every run, so canon goes along. */
export function promoteRequest(promote: PromotedReply): PromoteRequest {
  return {
    ...(promote.turn !== undefined ? { turn: promote.turn } : {}),
    ...(promote.canon !== undefined ? { context: { [CANON_CONTEXT_KEY]: promote.canon } } : {}),
  }
}

/**
 * The reply promoted and whatever the engine ran read as a run stream — under
 * the run it was called on, or under the fork the engine named instead. Every
 * refusal comes back as words to show; only an unreachable engine still throws.
 */
export function runPromote(engine: EngineClient, promote: PromotedReply, onEvent?: (event: RunEvent) => void): Promise<StreamedRun> {
  const { runId, nodeId } = promote
  return streamOrRefusal(() => engine.promoteNode({ runId, nodeId }, promoteRequest(promote)), error => refusal(error, promote), onEvent)
}

/** A node inside a loop, a `turn` out of range and a node that is no proposer all come back as 400. */
function refusal(error: EngineHttpError, promote: PromotedReply): string | undefined {
  if (error.status === 409) return `Run ${promote.runId} is still running — use ${promote.name}'s reply once it stops`
  if (error.status === 404) return `Run ${promote.runId} no longer has a node for ${promote.name}`
  if (error.status === 400) return `${promote.name}'s reply cannot be used as the revision: ${engineSaid(error)}`
  return undefined
}
