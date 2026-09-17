import { isEvent, type RunEvent } from '../engine/types'
import type { RunOutcome, StreamedRun } from './headlessRun'

/**
 * The run a call turned out to be under, for resume and promote alike: the
 * stream's first `run_start`, never the id posted to (ADR-0013).
 */

/** What a call that may fork came back with; `outcome.runId` is the run of record. */
export type ForkedRun = { kind: 'ran'; outcome: RunOutcome; forked: boolean } | { kind: 'refused'; said: string }

/**
 * `stream` read to its end under the run its first `run_start` names, rather
 * than the one `calledOn` posted to. A stream naming no run leaves the outcome's
 * own id to stand, and a refusal — nothing streamed — passes straight through.
 */
export async function underRunOfRecord(
  calledOn: string,
  stream: (onEvent: (event: RunEvent) => void) => Promise<StreamedRun>,
  onEvent?: (event: RunEvent) => void,
): Promise<ForkedRun> {
  let started: string | undefined
  const streamed = await stream(event => {
    if (started === undefined && isEvent(event, 'run_start')) started = event.runId
    onEvent?.(event)
  })
  if (streamed.kind === 'refused') return streamed
  const runId = started ?? streamed.outcome.runId
  return {
    kind: 'ran',
    outcome: { ...streamed.outcome, ...(runId !== undefined ? { runId } : {}) },
    forked: runId !== undefined && runId !== calledOn,
  }
}
