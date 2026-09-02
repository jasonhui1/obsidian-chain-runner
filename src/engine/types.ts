/**
 * The engine's wire shapes, narrowed to what this plugin reads.
 *
 * These mirror `maestro-playground`'s `lib/types.ts` and `lib/layoutModel.ts`
 * rather than importing them — the engine is a separate process reached over
 * HTTP, so its types cross the wire as data. Fields the plugin never reads are
 * deliberately absent; every shape here is treated as a subset of what arrives.
 */

/** Which picker heading a chain groups under; unset means the unlabeled fourth heading. */
export type ChainPurpose = 'insight' | 'production' | 'stress-test'

/** The one user-facing dropdown a chain may declare. */
export interface ChainParameter {
  name: string
  options: string[]
}

/** A chain as the add-chain picker needs it. */
export interface ChainSummary {
  slug: string
  name: string
  /** The situation that should make you reach for this chain; display-only. */
  moment?: string
  purpose?: ChainPurpose
  parameter?: ChainParameter
}

export interface AgentOutput {
  nodeId?: string
  agentName: string
  output: string
  status: 'success' | 'error' | 'skipped'
  error?: string
  timestamp: string
  [key: string]: unknown
}

export interface RunMeta {
  runId: string
  chainName: string
  seedPrompt: string
  parameter?: { name: string; value: string }
  startedAt: string
  completedAt?: string
  status: 'running' | 'complete' | 'error'
  agentOutputs: AgentOutput[]
  [key: string]: unknown
}

export type LayoutKind = 'timeline' | 'columns' | 'sidebar' | 'undeclared'

export type PanelState = 'pending' | 'empty' | 'errored' | 'skipped' | 'filled'

export interface LayoutPanel {
  name: string
  text: string
  lines: number
  state: PanelState
  emphasis?: 'last' | 'join'
  error?: string
  round?: number
}

export interface LayoutModel {
  kind: LayoutKind
  panels: LayoutPanel[]
}

/** What `POST /api/run` is asked for. A run names a chain and supplies its inputs. */
export interface RunRequest {
  /** Chain name or slug — the engine resolves by name first, then slug. */
  chainName: string
  seedPrompt: string
  /** The pick for the chain's declared dropdown, when it declares one. */
  paramValue?: string
}

export interface AgentStartEvent {
  type: 'agent_start'
  agentName: string
  nodeId: string
  step: number
  kind?: string
}

export interface TokenEvent {
  type: 'token'
  agentName?: string
  nodeId: string
  token: string
  /** `'thought'` on reasoning tokens; absent or `'output'` on answer tokens. */
  tokenType?: string
  step?: number
  turn?: number
}

export interface AgentDoneEvent {
  type: 'agent_done'
  agentName: string
  nodeId: string
  step: number
  output: AgentOutput
}

export interface RunCompleteEvent {
  type: 'run_complete'
  runId: string
}

export interface RunErrorEvent {
  type: 'error'
  error: string
}

/**
 * Events the engine emits that this ticket does not model — tool turns,
 * `section_missing`. They still reach the consumer so a later ticket can read
 * them without the client changing (#3).
 */
export interface UnknownRunEvent {
  type: string
  [key: string]: unknown
}

/** The events this ticket models, and can narrow to. */
export type KnownRunEvent =
  | AgentStartEvent
  | TokenEvent
  | AgentDoneEvent
  | RunCompleteEvent
  | RunErrorEvent

export type RunEvent = KnownRunEvent | UnknownRunEvent

/**
 * Narrows an event to one of the modelled kinds.
 *
 * `RunEvent`'s open member has an index signature, so it absorbs every tagged
 * member and a bare `event.type === 'run_complete'` never narrows on its own.
 * This is how a consumer reads a specific event without casting.
 */
export function isEvent<T extends KnownRunEvent['type']>(
  event: RunEvent,
  type: T,
): event is Extract<KnownRunEvent, { type: T }> {
  return event.type === type
}
