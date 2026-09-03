import { engineFailureMessage } from '../engine/guard'
import { EngineOfflineError, RequestAbortedError } from '../engine/transport'
import { applyRunEvent, emptyRunState, type RunState } from './session'
import type { EngineClient } from '../engine/client'
import type { Capabilities, RunRequest } from '../engine/types'

/**
 * One run, from launch to the last event — for every surface that shows one.
 *
 * The two surfaces differ in what they *do* with a run: the quick path redraws a
 * sidebar, the drawing relabels a node and then writes notes. What a run's
 * stream means — which errors are the engine's, which end it quietly, what a
 * dropped connection is worth saying — is the same on both, and is here so there
 * is one copy of it. That is ADR-0001's argument applied one layer down: a rule
 * with two implementations drifts, and nothing fails when it does.
 */

/**
 * Said when the engine does not stream layout frames. Named as the thing that is
 * missing rather than as a failure, because the fix is on the engine's side.
 */
export const UNSUPPORTED_ENGINE =
  'This engine is too old for Chain Runner: it does not stream layout frames. Update maestro-playground.'

/**
 * Whether the engine projects its own panels (ADR-0001). A surface that draws a
 * run refuses one that does not, rather than drawing a rule it no longer owns.
 */
export function streamsLayout(capabilities: Capabilities): boolean {
  return capabilities.runLayoutFrames === true
}

/** How a run's stream ended. */
export interface RunOutcome {
  /** The fold of every event that arrived, before it is settled. */
  state: RunState
  /** What stopped the caller reaching the end — an offline engine, a refusal. */
  failure?: string
  /**
   * The run was dropped rather than finished: the plugin unloaded, or a newer
   * run replaced it. Nothing is left to tell, and the caller does nothing.
   */
  aborted: boolean
}

/**
 * Runs a chain, handing each new state to `onState` as it arrives.
 *
 * An engine `error` event is part of the state, not a throw — the run reached
 * the engine and the engine has something to say. Only an unreachable engine or
 * a refused request ends up here, and both are said once and reported back.
 * Anything else is a bug and is rethrown.
 */
export async function streamRun(input: {
  engine: EngineClient
  request: RunRequest
  signal: AbortSignal
  /** Called after every event, with the run so far. */
  onState: (state: RunState) => void | Promise<void>
  notify: (message: string) => void
  /** Moves the status pill offline on first-hand evidence, rather than at the next poll. */
  markOffline: () => void
}): Promise<RunOutcome> {
  let state = emptyRunState()
  try {
    for await (const event of input.engine.launchRun(input.request, input.signal)) {
      state = applyRunEvent(state, event)
      await input.onState(state)
    }
  } catch (error) {
    if (error instanceof RequestAbortedError) return { state, aborted: true }
    const failure = engineFailureMessage(error)
    if (failure === undefined) throw error
    if (error instanceof EngineOfflineError) input.markOffline()
    input.notify(failure)
    return { state, failure, aborted: false }
  }
  return { state, aborted: false }
}
