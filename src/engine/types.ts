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
 * A chain as the picker and the result view need it.
 *
 * `view` and `outputs` are the chain's layout declaration. The plugin reads them
 * so it can build the same panels the engine's `/layout` route builds, while the
 * run is still streaming — that route only answers for a run already on disk.
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
  /**
   * Whether the chain reads a seed at all. One that declares no seed node reads
   * the files it pins instead, and the note it was run on reaches nothing.
   */
  seeded?: boolean
  /** The panels of that layout, in reading order. */
  outputs?: ChainPort[]
}

/**
 * The situation a chain is for, in its own words — what the picker leads with
 * and the result header repeats. `description` is the mechanism, and is the
 * fallback for a chain that states no moment.
 */
export function momentOf(chain: ChainSummary): string {
  return chain.moment || chain.description || ''
}

/**
 * The dropdown a chain must be asked for before it can run, or `undefined` when
 * there is nothing to ask. A chain reads its parameter as an input, so running
 * one with the value unset runs a different chain than the reader picked — but a
 * dropdown declared with no options has no value to offer, and asking for one
 * would be a modal with nothing in it.
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
  /**
   * The inner node this panel's port binds to. A live view overlays tokens onto
   * the panel currently writing, and token events are keyed by `nodeId`; without
   * this the only join would be the display name (ADR-0017).
   */
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
 * What this engine can do, for a client that ships separately from it. Read from
 * `/api/workspace` and feature-detected rather than pinned to a version, so an
 * old engine fails loudly instead of this plugin drawing a rule it no longer
 * owns (ADR-0017).
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
 * The panels, as the engine itself projects them — one frame before the first
 * hop and one after every `agent_done` (ADR-0017).
 *
 * This is why the plugin holds no copy of `buildLayoutModel`. The rule has one
 * implementation and one owner; a chain edited in the workspace changes what is
 * drawn here without this repo being touched.
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
  | LayoutFrameEvent
  | RunStartEvent
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
