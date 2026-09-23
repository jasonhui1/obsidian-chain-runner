import { fillLiveOutputs, type LiveOutput, type PlacedPanel } from './liveOutputs'
import { buildRunPanels, type RunLayout } from '../run/panels'
import { settleRun, type RunState } from '../run/session'
import { streamRun } from '../run/stream'
import type { EngineClient } from '../engine/client'
import type { ChainSummary, LayoutModel, RunEvent, RunRequest } from '../engine/types'

/**
 * A chain run landing as output notes, for both surfaces that land one: the
 * stream, the notes filling in place (ADR-0003), and the settled state at the
 * end. Where the notes go is the caller's `place` — called once, on the first
 * frame that names the panels, so placement is initial only.
 */

export interface ChainRunOutcome<P> {
  state: RunState
  /** What stopped the run reaching the end. Already said, so it is not said twice. */
  failure?: string
  /** Dropped rather than finished: the plugin unloaded. */
  aborted: boolean
  /** The outputs opened; `undefined` when there was never anything to place. */
  live?: LiveOutput<P>[]
}

type RunSource = { request: RunRequest; events?: never } | { request?: never; events: AsyncIterable<RunEvent> }

export type RunIntoNotesInput<P extends PlacedPanel> = RunSource & {
  engine: EngineClient
  chain: ChainSummary
  signal: AbortSignal
  notify: (message: string) => void
  markOffline: () => void
  holdReached: (runId: string, nodeId: string) => Promise<void>
  /** Said as the run goes, for a surface with somewhere to say it. */
  onProgress?: (model: LayoutModel | undefined) => Promise<void>
  /** Where the outputs land. An empty list is a run whose notes were all refused. */
  place: (runId: string, layout: RunLayout) => Promise<LiveOutput<P>[]>
}

export async function runIntoNotes<P extends PlacedPanel>(input: RunIntoNotesInput<P>): Promise<ChainRunOutcome<P>> {
  let live: LiveOutput<P>[] | undefined

  const source: { request: RunRequest } | { events: AsyncIterable<RunEvent> } = input.events
    ? { events: input.events }
    : { request: input.request! }
  const outcome = await streamRun({
    engine: input.engine,
    ...source,
    signal: input.signal,
    onState: async state => {
      await input.onProgress?.(state.layout)
      const layout = buildRunPanels(input.chain, state.layout, state.nodes)
      // Placed on the first frame that names panels, and never again.
      if (live === undefined && state.runId && layout.panels.length > 0) {
        live = await input.place(state.runId, layout)
      }
      if (live) await fillLiveOutputs(live, layout, false)
    },
    holdReached: input.holdReached,
    notify: input.notify,
    markOffline: input.markOffline,
  })
  if (outcome.aborted) return { state: outcome.state, aborted: true, ...(live ? { live } : {}) }

  const state = settleRun(outcome.state, outcome.failure)
  // A failed run's last frame carries the outcome, so nothing is settled here (ADR-0003).
  if (live) await fillLiveOutputs(live, buildRunPanels(input.chain, state.layout, state.nodes), true)
  return {
    state,
    aborted: false,
    ...(outcome.failure ? { failure: outcome.failure } : {}),
    ...(live ? { live } : {}),
  }
}
