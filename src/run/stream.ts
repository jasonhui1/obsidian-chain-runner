import { engineFailureMessage } from '../engine/guard'
import { EngineOfflineError, RequestAbortedError } from '../engine/transport'
import { answer } from './answer'
import { applyRunEvent, emptyRunState, type RunState } from './session'
import type { EngineClient } from '../engine/client'
import { isEvent, type Capabilities, type RunEvent, type RunRequest } from '../engine/types'

/** One run, from launch to the last event, for both surfaces that show one. */

export const UNSUPPORTED_ENGINE =
  'This engine is too old for Chain Runner: it does not stream layout frames. Update maestro-playground.'

/** Whether the engine projects its own panels (ADR-0001). */
export function streamsLayout(capabilities: Capabilities): boolean {
  return capabilities.runLayoutFrames === true
}

export const UNSUPPORTED_STREAMING =
  'This engine is too old to stream a run onto a drawing: it does not report a run id up front, or a final frame when a run fails. Update maestro-playground.'

/**
 * Whether outputs can land as the run goes (ADR-0003). `run_start` names the run
 * before there is anything to file; without a failure frame, a dead panel stays
 * `pending` and only the plugin could say otherwise.
 */
export function streamsOutputs(capabilities: Capabilities): boolean {
  return (
    streamsLayout(capabilities) &&
    capabilities.runStartEvent === true &&
    capabilities.runFailureFrame === true
  )
}

type StreamRunBase = {
  engine: EngineClient
  signal: AbortSignal
  onState: (state: RunState) => void | Promise<void>
  /** Each hold the run reaches; several can open in one wave. */
  holdReached: (runId: string, nodeId: string) => Promise<void>
  notify: (message: string) => void
  markOffline: () => void
}

export type RunEventSource =
  | { request: RunRequest; events?: never }
  | { request?: never; events: AsyncIterable<RunEvent> }

export type StreamRunInput = StreamRunBase & RunEventSource

/** How a run's stream ended, as the drawing surfaces read it. */
interface DrawnRun {
  state: RunState
  /** What stopped the caller reaching the end — an offline engine, a refusal. */
  failure?: string
  /** Dropped rather than finished: the plugin unloaded, or a newer run replaced it. */
  aborted: boolean
}

/**
 * Runs a chain, handing each new state to `onState`. An engine `error` event is
 * part of the state, not a throw; anything but an unreachable engine or a
 * refused request is a bug and is rethrown.
 */
export async function streamRun(input: StreamRunInput): Promise<DrawnRun> {
  let state = emptyRunState()
  try {
    const answered = await answer(input.engine, {
      open: () => input.events ?? input.engine.launchRun(input.request, input.signal),
      onEvent: async event => {
        state = applyRunEvent(state, event)
        await input.onState(state)
        if (isEvent(event, 'run_waiting')) await input.holdReached(event.runId, event.nodeId)
      },
    })
    if (answered.kind === 'refused') {
      input.notify(answered.said)
      return { state, failure: answered.said, aborted: false }
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
