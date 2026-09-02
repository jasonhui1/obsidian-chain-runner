import { EngineHttpError, EngineOfflineError } from './transport'
import type { EngineState } from './status'

/** The one thing the plugin says when the engine is not there. */
export const OFFLINE_NOTICE = 'engine offline'

/**
 * What to say about a failure that is the engine's rather than the plugin's, and
 * `undefined` for anything else — which is a bug and belongs thrown.
 *
 * The guard below turns this into a notice. The quick path, which also has
 * somewhere to *show* the failure, reads it directly rather than re-deriving
 * the same two cases.
 */
export function engineFailureMessage(error: unknown): string | undefined {
  if (error instanceof EngineOfflineError) return OFFLINE_NOTICE
  if (error instanceof EngineHttpError) return `engine error ${error.status}: ${error.body || error.message}`
  return undefined
}

export interface EngineGuardDeps {
  /** Checks the engine now; a stale poll is not good enough to act on. */
  refresh: () => Promise<EngineState>
  notify: (message: string) => void
  /** Moves the pill offline without waiting for the next poll. */
  markOffline: () => void
}

/**
 * Wraps every plugin action that needs the engine.
 *
 * Offline is checked twice over: once before starting, and again by catching
 * the engine dropping mid-action. Both end the same way — a notice, and
 * nothing else happens. An engine that answered and refused is a different
 * event and keeps its own message, so a 404 is not misread as a stopped server.
 */
export function createEngineGuard(deps: EngineGuardDeps) {
  return async function withEngine<T>(action: () => Promise<T>): Promise<T | undefined> {
    if ((await deps.refresh()) !== 'online') {
      deps.notify(OFFLINE_NOTICE)
      return undefined
    }
    try {
      return await action()
    } catch (error) {
      const message = engineFailureMessage(error)
      if (message === undefined) throw error
      if (error instanceof EngineOfflineError) deps.markOffline()
      deps.notify(message)
      return undefined
    }
  }
}
