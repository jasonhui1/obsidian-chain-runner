/**
 * The engine's wire shapes, narrowed to what this plugin reads. They mirror
 * `maestro-playground`'s `lib/types.ts` and `lib/layoutModel.ts`; every shape
 * here is a subset of what actually arrives.
 */

/** Which picker heading a chain groups under; unset means the unlabeled fourth heading. */
export type ChainPurpose = 'insight' | 'production' | 'stress-test'

/** The one user-facing dropdown a chain may declare. */
export interface ChainParameter {
  name: string
  options: string[]
}

/**
 * One of a chain's declared output sockets, and — under a declared `view` — one
 * panel of its result (ADR-0015, ADR-0016).
 */
export interface ChainPort {
  /** The chain's public name for this output; the panel's label. */
  name: string
  /** The inner node the port binds to. */
  node: string
  /** The section of that node's output the port carries; `output` means all of it. */
  socket?: string
  /** Marks the panel as a columns layout's converging panel. */
  role?: 'join'
}

/**
 * A layout a chain may declare. A `view:` the plugin does not know is dropped at
 * the client boundary, so everything above reads the three it can draw.
 */
export type ChainView = 'timeline' | 'columns' | 'sidebar'

/**
 * A chain as the picker and the result view need it. `view` and `outputs` are
 * its layout declaration, read so panels can be built while the run is still
 * streaming — the engine's `/layout` route only answers for a finished run.
 */
export interface ChainSummary {
  slug: string
  name: string
  /** The mechanism, in the chain's own words; the picker's fallback for `moment`. */
  description?: string
  /** The situation that should make you reach for this chain; display-only. */
  moment?: string
  purpose?: ChainPurpose
  parameter?: ChainParameter
  /** The result layout the chain opts into; absent means it declares none. */
  view?: ChainView
  /** Whether the chain reads a seed at all; an unseeded one reads the files it pins. */
  seeded?: boolean
  /** The panels of that layout, in reading order. */
  outputs?: ChainPort[]
}

/** The situation a chain is for, falling back to `description`, the mechanism. */
export function momentOf(chain: ChainSummary): string {
  return chain.moment || chain.description || ''
}

/**
 * The dropdown to ask for before running, or `undefined` when there is nothing
 * to ask — a dropdown declared with no options would be an empty modal.
 */
export function parameterToAsk(chain: ChainSummary): ChainParameter | undefined {
  const parameter = chain.parameter
  return parameter && parameter.options.length > 0 ? parameter : undefined
}

export interface AgentOutput {
  nodeId?: string
  agentName: string
  output: string
  status: 'success' | 'error' | 'skipped'
  error?: string
  timestamp: string
  /** Loop iteration, 0-based; set only on the outputs of a loop-body node. */
  round?: number
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
  /** The inner node this panel binds to; token events are keyed by it (ADR-0017). */
  node: string
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

/**
 * What this engine can do, read from `/api/workspace`. Feature-detected rather
 * than version-pinned, so an old engine fails loudly (ADR-0017).
 */
export interface Capabilities {
  /** `/api/run` streams `layout` frames, and every panel carries `node`. */
  runLayoutFrames?: boolean
  /** The run reports its id up front, as `run_start`. */
  runStartEvent?: boolean
  /** A failed run's last frame moves every pending panel to `errored` with its message. */
  runFailureFrame?: boolean
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

/**
 * The panels as the engine projects them — one frame before the first hop and
 * one after every `agent_done`, so the plugin keeps no copy of the rule
 * (ADR-0017).
 */
export interface LayoutFrameEvent {
  type: 'layout'
  model: LayoutModel
}

/** The run's id, before the first hop, for a surface that files outputs as it goes (ADR-0003). */
export interface RunStartEvent {
  type: 'run_start'
  runId: string
}

export interface RunCompleteEvent {
  type: 'run_complete'
  runId: string
}

export interface RunErrorEvent {
  type: 'error'
  error: string
}

/** Events not modelled here — tool turns, `section_missing` — still reach the consumer (#3). */
export interface UnknownRunEvent {
  type: string
  [key: string]: unknown
}

/** The events this ticket models, and can narrow to. */
export type KnownRunEvent =
  | AgentStartEvent
  | TokenEvent
  | AgentDoneEvent
  | LayoutFrameEvent
  | RunStartEvent
  | RunCompleteEvent
  | RunErrorEvent

export type RunEvent = KnownRunEvent | UnknownRunEvent

/**
 * Narrows an event to one of the modelled kinds. Needed because `UnknownRunEvent`'s
 * index signature absorbs every tagged member, so a bare `type ===` never narrows.
 */
export function isEvent<T extends KnownRunEvent['type']>(
  event: RunEvent,
  type: T,
): event is Extract<KnownRunEvent, { type: T }> {
  return event.type === type
}
