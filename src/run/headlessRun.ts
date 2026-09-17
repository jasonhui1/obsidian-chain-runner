import { engineFailureMessage } from '../engine/guard'
import { EngineHttpError } from '../engine/transport'
import type { EngineClient } from '../engine/client'
import { isEvent, runIdOf, type AgentOutput, type RunEvent, type RunRequest } from '../engine/types'

/** A run nothing draws while it goes — only the id it lands on matters. */

export interface RunOutcome {
  /** Set as soon as the engine names the run; a run that fails still gets one. */
  runId?: string
  error?: string
}

/** What a call that answers with a run stream came back with: the run it landed on, or a refusal already worded for the human. */
export type StreamedRun = { kind: 'ran'; outcome: RunOutcome } | { kind: 'refused'; said: string }

/**
 * A run stream drained to its end, with every refusal the engine answered
 * turned into words by `said` — which may leave a status it has nothing of its
 * own to say about. Only an unreachable engine still throws.
 */
export async function streamOrRefusal(
  open: () => AsyncIterable<RunEvent>,
  said: (error: EngineHttpError) => string | undefined,
  onEvent?: (event: RunEvent) => void,
): Promise<StreamedRun> {
  try {
    return { kind: 'ran', outcome: await drainRun(open(), onEvent) }
  } catch (error) {
    if (!(error instanceof EngineHttpError)) throw error
    return { kind: 'refused', said: said(error) ?? engineFailureMessage(error) ?? `Engine error ${error.status}` }
  }
}

/** Runs a request to completion and reports what it landed on, passing `onEvent` every event on the way. */
export function runHeadless(
  engine: EngineClient,
  request: RunRequest,
  onEvent: (event: RunEvent) => void = () => {},
): Promise<RunOutcome> {
  return drainRun(engine.launchRun(request), onEvent)
}

/** A run stream read to its end, reporting the run it names and the failure it hit. */
export async function drainRun(events: AsyncIterable<RunEvent>, onEvent: (event: RunEvent) => void = () => {}): Promise<RunOutcome> {
  let outcome: RunOutcome = {}
  for await (const event of events) {
    onEvent(event)
    const runId = runIdOf(event)
    if (runId) outcome = { ...outcome, runId }
    if (isEvent(event, 'error')) outcome = { ...outcome, error: event.error }
  }
  return outcome
}

/** A single agent's answer, nothing else in flight. */
export interface AgentOutcome extends RunOutcome {
  output?: AgentOutput
}

/** Runs one agent alone and reports the answer it gave. */
export async function runAgentOnce(engine: EngineClient, request: RunRequest): Promise<AgentOutcome> {
  let outcome: AgentOutcome = {}
  for await (const event of engine.launchRun(request)) {
    const runId = runIdOf(event)
    if (runId) outcome = { ...outcome, runId }
    if (isEvent(event, 'agent_done')) outcome = { ...outcome, output: event.output }
    if (isEvent(event, 'error')) outcome = { ...outcome, error: event.error }
  }
  return outcome
}
