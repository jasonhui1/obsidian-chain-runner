import { disclaims, mayLackRoute, type ProbedEndpoint } from '../engine/capabilities'
import { engineFailureMessage, engineSaid } from '../engine/guard'
import { EngineHttpError } from '../engine/transport'
import { isEvent, runIdOf, type ChatEvent, type RunEvent, type RunRequest } from '../engine/types'
import { underRunOfRecord } from './fork'
import type { EngineClient } from '../engine/client'

/**
 * What the engine answered a call that streams: run, resume, promote, chat
 * and side quest alike. Offline is not an answer — it throws, for the caller's
 * `withEngine` to say.
 */
export type Answer =
  | {
      kind: 'landed'
      /** The run of record; absent when the stream never named one. */
      runId?: string
      /** The engine named a run other than the one called (ADR-0013). */
      forked: boolean
      /** What the run hit partway through, when it failed. */
      error?: string
      /** The last thing the called agent said: a chat reply, or a lone agent's output. */
      reply?: string
    }
  | {
      kind: 'refused'
      /** Already worded for the human. */
      said: string
      /** The engine lacks the endpoint, rather than refusing this call. */
      unsupported?: true
    }

export type Landed = Extract<Answer, { kind: 'landed' }>

export type StreamEvent = RunEvent | ChatEvent

/** Told each event as it arrives, so a surface can draw the call going. */
export type OnEvent = (event: StreamEvent) => void | Promise<void>

/** How one endpoint words the engine's refusals, status by status. */
export interface Refusals {
  endpoint: ProbedEndpoint
  /** An engine without the endpoint. */
  unsupported: string
  /** A 404 an engine that never claimed the endpoint answered; `unsupported` when that can only be the route. */
  missingRoute?: string
  /** 409: the run is running. */
  running: (said: string) => string
  /** 404: what the call named is gone. */
  gone: string
  /** 400: the engine would not take the request. */
  invalid: (said: string) => string
  /** 422, for an endpoint that answers it. */
  unprocessable?: string
  /** Lets a caller refresh state after a conflict without changing the refusal message. */
  onConflict?: () => void
}

export interface EngineCall {
  open: () => AsyncIterable<StreamEvent>
  /** The run posted to, for a call the engine may fork. */
  calledOn?: string
  /** An endpoint the engine may lack; a plain run has none. */
  refusals?: Refusals
  onEvent?: OnEvent | undefined
}

/** A call streamed to its end, or refused with the engine's words. */
export async function answer(engine: EngineClient, call: EngineCall): Promise<Answer> {
  const refusals = call.refusals
  const capabilities = refusals ? await engine.capabilities() : {}
  if (refusals && disclaims(capabilities, refusals.endpoint)) return { kind: 'refused', said: refusals.unsupported, unsupported: true }

  const streamed = async (onEvent?: OnEvent): Promise<Answer> => {
    try {
      return await drain(call.open(), onEvent)
    } catch (error) {
      if (!(error instanceof EngineHttpError)) throw error
      if (error.status === 409) refusals?.onConflict?.()
      if (refusals && mayLackRoute(error, capabilities, refusals.endpoint)) {
        return refusals.missingRoute !== undefined
          ? { kind: 'refused', said: refusals.missingRoute }
          : { kind: 'refused', said: refusals.unsupported, unsupported: true }
      }
      return { kind: 'refused', said: refusal(error, refusals) }
    }
  }
  return call.calledOn === undefined ? streamed(call.onEvent) : underRunOfRecord(call.calledOn, streamed, call.onEvent)
}

/** A plain run of `request`: it carries on no run, so it forks none. */
export function launch(engine: EngineClient, request: RunRequest, onEvent?: OnEvent): Promise<Answer> {
  return answer(engine, { open: () => engine.launchRun(request), onEvent })
}

function refusal(error: EngineHttpError, refusals: Refusals | undefined): string {
  if (refusals) {
    if (error.status === 409) return refusals.running(engineSaid(error))
    if (error.status === 404) return refusals.gone
    if (error.status === 400) return refusals.invalid(engineSaid(error))
    if (error.status === 422 && refusals.unprocessable !== undefined) return refusals.unprocessable
  }
  return engineFailureMessage(error) ?? `Engine error ${error.status}`
}

/** A stream read to its end: the run it names, the failure it hit, the last reply heard. */
async function drain(events: AsyncIterable<StreamEvent>, onEvent?: OnEvent): Promise<Landed> {
  let landed: Landed = { kind: 'landed', forked: false }
  for await (const event of events) {
    await onEvent?.(event)
    const runId = runIdOf(event)
    if (runId) landed = { ...landed, runId }
    if (isEvent(event, 'agent_done')) landed = { ...landed, reply: event.output.output }
    if (isChatDone(event)) landed = { ...landed, reply: event.message.content }
    if (isEvent(event, 'error')) landed = { ...landed, error: event.error }
  }
  return landed
}

function isChatDone(event: StreamEvent): event is Extract<ChatEvent, { type: 'chat_done' }> {
  return event.type === 'chat_done'
}
