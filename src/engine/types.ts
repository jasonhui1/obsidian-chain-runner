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

/** One turn of a node's own transcript, as the chat endpoint keeps it. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  thought?: string
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
  /** The node's reasoning, stored but never replayed to a model — read-only in a hold note. */
  thought?: string
  /** The node's chat transcript; its assistant entries are the turns promote counts. */
  conversation?: ChatMessage[]
  [key: string]: unknown
}

/** Whether the engine still holds a run. `unknown` is an engine that could not be asked. */
export type RunExistence = 'found' | 'missing' | 'unknown'

/** The chain's graph as the run executed it, narrowed to the edges a walk needs. */
export interface RunGraph {
  edges: { fromNode: string; toNode: string }[]
}

/** One option a hold's decider wrote, as its `## Candidate N` section. */
export interface HoldCandidate {
  /** What a resume sends back as `chosen`. */
  heading: string
  body: string
}

/** A hold the run reached. There is no separate id: a hold is named by its `nodeId`. */
export interface HoldRecord {
  nodeId: string
  prompt?: string
  /** The decider's text, verbatim. */
  input: string
  candidates: HoldCandidate[]
  reachedAt: string
  chosen?: string
  custom?: string
  direction?: string
  resolvedAt?: string
  /** Changes whenever this hold's candidates change; sent back with a pick or reroll. */
  revision?: number
  /** Guidance saved for the next candidate reroll. */
  feedback?: string
  /** The last time the decider rerolled candidates for this hold. */
  rerolledAt?: string
}

/**
 * The holds still waiting on a human, one per node, in the order reached. The
 * engine's own "open hold", the one a resume answers, is the last of them.
 */
export function waitingHolds(holds: readonly HoldRecord[] = []): HoldRecord[] {
  const open = new Map<string, HoldRecord>()
  for (const hold of holds) {
    open.delete(hold.nodeId)
    if (!hold.resolvedAt) open.set(hold.nodeId, hold)
  }
  return [...open.values()]
}

export interface RunMeta {
  runId: string
  chainName: string
  seedPrompt: string
  parameter?: { name: string; value: string }
  startedAt: string
  completedAt?: string
  /** `waiting` is a run paused at a hold node until a human answers it. */
  status: 'running' | 'waiting' | 'complete' | 'error'
  agentOutputs: AgentOutput[]
  /** Every hold reached, answered or not. */
  holds?: HoldRecord[]
  graph?: RunGraph
  branchedFromRunId?: string
  /** Membership in a repeated run of one chain with the same resolved inputs. */
  variance?: { groupId: string; index: number; size: number }
  [key: string]: unknown
}

export interface VarianceSample {
  runId: string
  runIndex: number
  output: string
  status: AgentOutput['status']
  error?: string
}

export interface VarianceNode {
  nodeId: string
  nodeName: string
  round?: number
  /** The engine omits spread when the successful sample set is incomplete. */
  spread?: number
  successfulSampleCount: number
  expectedSampleCount: number
  samples: VarianceSample[]
}

export interface VarianceGroup {
  groupId: string
  chainName: string
  seedPrompt: string
  expectedRunCount: number
  completedRunCount: number
  costUsd?: number
  costWarning?: string
  runs: RunMeta[]
  nodes: VarianceNode[]
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
  /** `POST /api/runs/:id/nodes/:nodeId/chat` continues a node's own transcript (#54). */
  proposerChat?: boolean
  /**
   * A run can stop `waiting` at a hold node: `holds[]` on its meta, `run_waiting`
   * on its stream. Nothing gates on it: without them a hold note says the chain ended (#54).
   */
  runHolds?: boolean
  /** `POST /api/runs/:id/resume` answers a hold and carries the run on (#54). */
  runResume?: boolean
  /** `POST /api/runs/:id/nodes/:nodeId/promote` makes a chat reply the node's output (#54). */
  nodePromote?: boolean
  /** `POST /api/runs/:id/fork` reruns descendants of revised outputs (#67). */
  runFork?: boolean
  /** `POST /api/variance` repeats one resolved chain request and groups its runs. */
  varianceGroups?: boolean
  /** `POST /api/runs/:id/holds/:holdId/reroll` asks the decider for new candidates. */
  holdReroll?: boolean
  /** `PATCH /api/runs/:id/holds/:holdId` saves candidate feedback. */
  holdFeedback?: boolean
}

/** What `POST /api/run` is asked for. A run names a chain, or one agent alone, and supplies its inputs. */
export interface RunRequest {
  /** Chain name or slug — the engine resolves by name first, then slug. */
  chainName?: string
  /** Runs one agent alone, with no chain around it. Exclusive with `chainName`. */
  agentName?: string
  seedPrompt: string
  /** The pick for the chain's declared dropdown, when it declares one. */
  paramValue?: string
  /** Overrides a `context` node's file, keyed by the node's declared `file`. */
  context?: Record<string, string>
}

/** What `POST /api/variance` is asked for: one ordinary run request, repeated 2–10 times. */
export interface VarianceRequest extends RunRequest {
  count: number
}

/** What `POST /api/runs/:id/fork` is asked for. */
export interface ForkRequest {
  /** Full replacement output text, keyed by node id. */
  revisions: Record<string, string>
  /** Overrides a `context` node's file, keyed by its declared `file`. */
  context?: Record<string, string>
  /** Use the source run's pinned files; omitted uses current files. */
  versions?: 'pinned'
}

/**
 * What `POST /api/runs/:id/resume` is asked for: the hold's answer, and the
 * direction the run carries on under.
 */
export interface ResumeRequest {
  /** Required, and refused blank: what the run is told to do next. */
  direction: string
  /** The ticked candidate's heading. Exclusive with `custom`. */
  chosen?: string
  /** The human's own idea, when no candidate was ticked. Exclusive with `chosen`. */
  custom?: string
  /** The hold to answer, which is its `nodeId`; needed only when the engine cannot tell which. */
  holdId?: string
  /** The candidate set version the human picked from. */
  revision?: number
  /** Overrides a `context` node's file, keyed by the node's declared `file`. */
  context?: Record<string, string>
}

/**
 * What `POST /api/runs/:id/nodes/:nodeId/promote` is asked for: which reply of
 * the node's transcript becomes its output.
 */
export interface PromoteRequest {
  /** The 1-based `### Turn N` of the node's log; omitted promotes its last reply. */
  turn?: number
  /** Overrides a `context` node's file, keyed by the node's declared `file`. */
  context?: Record<string, string>
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

/** A hold reached; the stream ends after the last of a wave's, with no `run_complete`. */
export interface RunWaitingEvent {
  type: 'run_waiting'
  runId: string
  nodeId: string
  hold: HoldRecord
}

/** A decider reroll that produced no candidates, retaining the previous hold. */
export interface RerollFailedEvent {
  type: 'reroll_failed'
  runId: string
  nodeId: string
  error: string
}

export interface RunErrorEvent {
  type: 'error'
  error: string
}

/** All frames from a variance stream belong to one member until the group frame arrives. */
export type VarianceMemberEvent = RunEvent & { instance: number }

export interface VarianceCompleteEvent {
  type: 'variance_complete'
  groupId: string
  runIds: string[]
}

export type VarianceRunEvent = VarianceMemberEvent | VarianceCompleteEvent

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
  | RunWaitingEvent
  | RerollFailedEvent
  | RunErrorEvent

export type RunEvent = KnownRunEvent | UnknownRunEvent

/** The run's id, from any event that names the run. */
export function runIdOf(event: RunEvent): string | undefined {
  const named = isEvent(event, 'run_start') || isEvent(event, 'run_complete') || isEvent(event, 'run_waiting')
  return named ? event.runId : undefined
}

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

/**
 * The chat endpoint's own stream. It shares `token` and `error` with the run
 * stream by name only: nothing here names a run, a node or a step, so the run
 * stream's parser must not be pointed at it.
 */
export type ChatEvent =
  | { type: 'token'; token: string; tokenType?: string }
  | { type: 'chat_done'; message: ChatMessage }
  | { type: 'error'; error: string }

const CHAT_EVENTS = ['token', 'chat_done', 'error']

/** The engine sends only these three down a chat stream; anything else on the wire is not ours. */
export function isChatEvent(payload: unknown): payload is ChatEvent {
  return typeof payload === 'object' && payload !== null && CHAT_EVENTS.includes((payload as ChatEvent).type)
}
