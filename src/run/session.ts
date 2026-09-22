import { buildRunPanels, emptyRunNodes, type RunLayout, type RunNodes } from './panels'
import type { SeedOrigin } from './seed'
import { isEvent, momentOf, runIdOf, type ChainSummary, type LayoutModel, type RunEvent } from '../engine/types'

/**
 * A run as the result view watches it happen. The fold is kept apart from the
 * view so what a stream of events means is checkable without a vault.
 */

/**
 * `running` — the stream is still open.
 * `done`    — it closed and nothing failed.
 * `failed`  — it closed and a hop failed, or the run never got that far.
 */
export type RunStatus = 'running' | 'done' | 'failed'

export interface RunState {
  nodes: RunNodes
  /** The engine's panels, from the last `layout` frame; absent before the first (ADR-0017). */
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

/** Tokens that are the node's answer, not its tool narration or its reasoning. */
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
        // The partial is kept: the `layout` frame lands a beat later, and
        // clearing here would blank the panel for that beat.
        started: withStarted(state.nodes, event.nodeId, event.output.agentName),
      },
    }
  }

  // The engine's own projection, not one recomputed here (ADR-0017).
  if (isEvent(event, 'layout')) return { ...state, layout: event.model }

  // Every event naming the run carries the same id; the first arrives early enough to file outputs mid-run.
  const runId = runIdOf(event)
  if (runId) return { ...state, runId }
  if (isEvent(event, 'error')) return { ...state, error: event.error }

  // Tool turns and section warnings reach here and are not modelled.
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
 * `Seed` in `./seed` is the engine's half — the words, not the note.
 */
export interface RunSeed {
  /** The name of the note the run was invoked from, whether or not it seeded the chain. */
  note: string
  from: SeedOrigin
}

/** How much of the note a run read; the whole note needs no qualifier. */
const HOW_MUCH: Partial<Record<SeedOrigin, string>> = {
  selection: ' (selection)',
  marks: ' (kept lines)',
}

/** The header's one line about the seed. */
export function seedLine(seed: RunSeed): string {
  if (seed.from === 'none') return 'seed: no hint'
  return `seed: ${seed.note}${HOW_MUCH[seed.from] ?? ''}`
}

/** Everything the result view renders, for a run at one moment. */
export interface RunResult {
  chainName: string
  /** The situation this chain is for; its description when it states no moment. */
  moment: string
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
