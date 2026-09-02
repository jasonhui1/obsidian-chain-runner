import { buildRunLayout, emptyRunNodes, type RunLayout, type RunNodes } from './layout'
import { isEvent, type ChainSummary, type RunEvent } from '../engine/types'

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

/** Drops a node's partial text without leaving a key behind for a panel to read. */
function withoutStreaming(streaming: Record<string, string>, nodeId: string): Record<string, string> {
  const next = { ...streaming }
  delete next[nodeId]
  return next
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
        outputs: [...state.nodes.outputs, { ...event.output, nodeId: event.nodeId }],
        // The settled output is the panel's text from here on; the partial would
        // otherwise show beside it.
        streaming: withoutStreaming(state.nodes.streaming, event.nodeId),
        started: withStarted(state.nodes, event.nodeId, event.output.agentName),
      },
    }
  }

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

/** Everything the result view renders, for a run at one moment. */
export interface RunResult {
  chainName: string
  /** The situation this chain is for; its description when it states no moment. */
  moment: string
  /** Where the seed came from — the note this was run on. */
  seedSource: string
  /** The dropdown the chain declared and what it was set to, when it declared one. */
  parameter?: { name: string; value: string }
  status: RunStatus
  /** Why it failed: the first hop that failed, or what stopped the run starting. */
  error?: string
  runId?: string
  layout: RunLayout
}

/** The first failure the run reported, whichever hop carried it. */
function hopFailure(state: RunState): string | undefined {
  const failed = state.nodes.outputs.find(output => output.status === 'error')
  if (!failed) return undefined
  return failed.error || 'this hop failed'
}

export function buildRunResult(input: {
  chain: ChainSummary
  seedSource: string
  state: RunState
  /** What the chain's dropdown was set to; ignored by a chain that declares none. */
  paramValue?: string
}): RunResult {
  const { chain, seedSource, state, paramValue } = input
  const error = state.error ?? hopFailure(state)

  const result: RunResult = {
    chainName: chain.name,
    moment: chain.moment || chain.description || '',
    seedSource,
    status: !state.settled ? 'running' : error ? 'failed' : 'done',
    layout: buildRunLayout(chain, state.nodes),
  }
  if (error) result.error = error
  if (state.runId) result.runId = state.runId
  if (chain.parameter && paramValue) result.parameter = { name: chain.parameter.name, value: paramValue }
  return result
}
