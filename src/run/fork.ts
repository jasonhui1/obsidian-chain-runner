import { isEvent } from '../engine/types'
import type { Answer, OnEvent } from './answer'

/**
 * The run a call turned out to be under, for resume and promote alike: the
 * stream's first `run_start`, never the id posted to (ADR-0013).
 */

/**
 * `stream` read to its end under the run its first `run_start` names, rather
 * than the one `calledOn` posted to. A stream naming no run leaves the answer's
 * own id to stand, and a refusal — nothing streamed — passes straight through.
 */
export async function underRunOfRecord(calledOn: string, stream: (onEvent: OnEvent) => Promise<Answer>, onEvent?: OnEvent): Promise<Answer> {
  let started: string | undefined
  const answered = await stream(event => {
    if (started === undefined && isEvent(event, 'run_start')) started = event.runId
    return onEvent?.(event)
  })
  if (answered.kind === 'refused') return answered
  const runId = started ?? answered.runId
  return { ...answered, ...(runId !== undefined ? { runId } : {}), forked: runId !== undefined && runId !== calledOn }
}
