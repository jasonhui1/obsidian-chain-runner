import type { EngineHttpError } from './transport'
import type { Capabilities } from './types'

/**
 * The endpoints an engine too old to report its capabilities may still have.
 * Their flag is read three ways: `true` has it, `false` has not, and absent
 * leaves only the call itself to find out (ADR-0017, #54).
 */
export type ProbedEndpoint = 'proposerChat' | 'runResume' | 'nodePromote'

/** The engine says it has no such endpoint: nothing is worth asking. */
export function disclaims(capabilities: Capabilities, endpoint: ProbedEndpoint): boolean {
  return capabilities[endpoint] === false
}

/** A 404 from an engine that never said whether it has the endpoint, which may be the route itself missing. */
export function mayLackRoute(error: EngineHttpError, capabilities: Capabilities, endpoint: ProbedEndpoint): boolean {
  return error.status === 404 && capabilities[endpoint] === undefined
}
