import { engineFailureMessage, engineSaid } from '../engine/guard'
import { EngineHttpError } from '../engine/transport'
import { isEvent, type HoldRecord } from '../engine/types'
import type { EngineClient } from '../engine/client'
import type { OnEvent } from './answer'

export const UNSUPPORTED_REROLL = 'This engine cannot reroll hold candidates. Update maestro-playground.'

export type RerollAnswer =
  | { kind: 'landed'; runId: string; hold: HoldRecord; error?: string }
  | { kind: 'stale'; said: string }
  | { kind: 'refused'; said: string; unsupported?: true }

/** Re-runs only the decider at one open hold and returns its final waiting frame. */
export async function runReroll(
  engine: EngineClient,
  runId: string,
  holdId: string,
  revision: number,
  onEvent?: OnEvent,
): Promise<RerollAnswer> {
  const capabilities = await engine.capabilities()
  if (capabilities.holdReroll !== true) return { kind: 'refused', said: UNSUPPORTED_REROLL, unsupported: true }

  let started: string | undefined
  let waiting: { runId: string; hold: HoldRecord } | undefined
  let failed: string | undefined
  try {
    for await (const event of engine.rerollHold(runId, holdId, revision)) {
      await onEvent?.(event)
      if (isEvent(event, 'run_start') && started === undefined) started = event.runId
      if (isEvent(event, 'reroll_failed') && event.nodeId === holdId) failed = event.error
      if (isEvent(event, 'run_waiting') && event.nodeId === holdId) waiting = { runId: event.runId, hold: event.hold }
    }
  } catch (error) {
    if (!(error instanceof EngineHttpError)) throw error
    const reason = engineSaid(error) ?? engineFailureMessage(error) ?? `engine error ${error.status}`
    if (error.status === 409) return { kind: 'stale', said: reason }
    if (error.status === 404) return { kind: 'refused', said: `Run ${runId} no longer has the open hold ${holdId}` }
    if (error.status === 400) return { kind: 'refused', said: `The engine would not reroll hold ${holdId}: ${reason}` }
    return { kind: 'refused', said: reason }
  }

  if (waiting) return { kind: 'landed', runId: waiting.runId || started || runId, hold: waiting.hold, ...(failed ? { error: failed } : {}) }
  return { kind: 'refused', said: failed ? `Reroll failed: ${failed}` : 'Reroll produced no waiting hold' }
}
