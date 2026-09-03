import { buildRunPanels, emptyRunNodes, type RunLayout, type RunNodes } from './panels'
import type { SeedOrigin } from './seed'
import { isEvent, momentOf, type ChainSummary, type LayoutModel, type RunEvent } from '../engine/types'

/**
 * A run as the result view watches it happen.
 *
 * The fold is separate from the view for the same reason the engine client is
 * separate from the status pill: what a stream of events means is checkable
 * without a vault, and the view is left with nothing to decide.
 */

/**
 * `running` — the stream is still open.
 * `done`    — it closed and nothing failed.
 * `failed`  — it closed and a hop failed, or the run never got that far.
 */
export type RunStatus = 'running' | 'done' | 'failed'

export interface RunState {
  nodes: RunNodes
  /**
   * The engine's own panels, from the last `layout` frame. Absent only before the
   * first one, which the engine sends before the run's first hop (ADR-0017).
   */
  layout?: LayoutModel
  /** The engine's id for this run, which arrives at the end. */
  runId?: string
  /** What the run reported as an event, or what stopped the caller reaching it. */
  error?: string
  /** Whether the stream has closed, however it closed. */
  settled: boolean
}

export function emptyRunState(): RunState {
  return { nodes: emptyRunNodes(), settled: false }
}

/** Tokens that are the node's answer. A turn's are its tool narration, and a
 *  thought is its reasoning; the engine overwrites the panel with neither. */
function isAnswerToken(event: { tokenType?: string; turn?: number }): boolean {
  return event.tokenType !== 'thought' && event.turn === undefined
}

function withStarted(nodes: RunNodes, nodeId: string, agentName: string): RunNodes['started'] {
  // A loop-body node starts once per round; the trace lists it once, where it first ran.
  return nodes.started.some(node => node.nodeId === nodeId)
    ? nodes.started
    : [...nodes.started, { nodeId, agentName }]
}

export function applyRunEvent(state: RunState, event: RunEvent): RunState {
  if (isEvent(event, 'agent_start')) {
    return {
      ...state,
      nodes: {
        ...state.nodes,
        // A node running its second round starts from nothing, not from round one.
        streaming: { ...state.nodes.streaming, [event.nodeId]: '' },
        started: withStarted(state.nodes, event.nodeId, event.agentName),
      },
    }
  }

  if (isEvent(event, 'token')) {
    if (!isAnswerToken(event)) return state
    const soFar = state.nodes.streaming[event.nodeId] ?? ''
    return {
      ...state,
      nodes: { ...state.nodes, streaming: { ...state.nodes.streaming, [event.nodeId]: soFar + event.token } },
    }
  }

  if (isEvent(event, 'agent_done')) {
    return {
      ...state,
      nodes: {
        ...state.nodes,
        outputs: [...state.nodes.outputs, { ...event.output, nodeId: event.nodeId }],
        // The partial is kept, not dropped: the engine's `layout` frame lands a
        // beat after `agent_done`, and clearing here would blank the panel for
        // that beat. It stops being read the moment the panel is no longer
        // pending, and `agent_start` clears it when the node runs again.
        started: withStarted(state.nodes, event.nodeId, event.output.agentName),
      },
    }
  }

  // The panels are the engine's answer, not a projection recomputed here: one
  // rule, one owner, and a chain edited in the workspace redraws this view
  // without the plugin changing (ADR-0017).
  if (isEvent(event, 'layout')) return { ...state, layout: event.model }

  // Both carry the same id; the first is what lets a surface file its outputs
  // while the run is still going.
  if (isEvent(event, 'run_start')) return { ...state, runId: event.runId }
  if (isEvent(event, 'run_complete')) return { ...state, runId: event.runId }
  if (isEvent(event, 'error')) return { ...state, error: event.error }

  // Tool turns and section warnings reach here and are not modelled; a later
  // ticket reads them without this fold changing shape.
  return state
}

/**
 * Closes the run. `error` is a failure the caller met on the way — an offline
 * engine, a rejected request — that no event could carry.
 */
export function settleRun(state: RunState, error?: string): RunState {
  return { ...state, settled: true, error: state.error ?? error }
}

/**
 * The seed of a run, as the header names it: which note, and how much of it.
 *
 * `Seed` in `./seed` is the same fact for the other audience — it carries the
 * text, because the engine is sent the words and not the note they came from.
 * Neither side wants the other's half, so they stay two records rather than one
 * the view would have to hold a whole note in.
 */
export interface RunSeed {
  /** The name of the note the run was invoked on. */
  note: string
  from: SeedOrigin
}

/**
 * The header's one line about the seed. A selection run covers less than the
 * note it was taken from, so it says which of the two happened; a whole-note run
 * needs no qualifier, and adding one to every run would say nothing.
 */
export function seedLine(seed: RunSeed): string {
  return seed.from === 'selection' ? `seed: ${seed.note} (selection)` : `seed: ${seed.note}`
}

/** Everything the result view renders, for a run at one moment. */
export interface RunResult {
  chainName: string
  /** The situation this chain is for; its description when it states no moment. */
  moment: string
  /**
   * Where the seed came from: the note the run was invoked on, and whether the
   * whole of it was read or only the passage that was selected.
   */
  seed: RunSeed
  /** The dropdown the chain declared and what it was set to, when it declared one. */
  parameter?: { name: string; value: string }
  status: RunStatus
  /** Why it failed: the first hop that failed, or what stopped the run starting. */
  error?: string
  runId?: string
  layout: RunLayout
}

/** Why a run failed, in the engine's words: what stopped it, else the first failed hop. */
export function runFailure(state: RunState): string | undefined {
  if (state.error) return state.error
  const failed = state.nodes.outputs.find(output => output.status === 'error')
  if (!failed) return undefined
  return failed.error || 'this hop failed'
}

export function buildRunResult(input: {
  chain: ChainSummary
  seed: RunSeed
  state: RunState
  /** What the chain's dropdown was set to; ignored by a chain that declares none. */
  paramValue?: string
}): RunResult {
  const { chain, seed, state, paramValue } = input
  const error = runFailure(state)

  const result: RunResult = {
    chainName: chain.name,
    moment: momentOf(chain),
    seed,
    status: !state.settled ? 'running' : error ? 'failed' : 'done',
    layout: buildRunPanels(chain, state.layout, state.nodes),
  }
  if (error) result.error = error
  if (state.runId) result.runId = state.runId
  if (chain.parameter && paramValue) result.parameter = { name: chain.parameter.name, value: paramValue }
  return result
}
