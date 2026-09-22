import { parseSse } from './sse'
import { isChatEvent } from './types'
import {
  EngineHttpError,
  EngineOfflineError,
  type HttpRequest,
  type HttpTransport,
} from './transport'
import type {
  Capabilities,
  ChainPort,
  ChainSummary,
  ChainView,
  ChatEvent,
  ForkRequest,
  LayoutModel,
  PromoteRequest,
  RunEvent,
  RunExistence,
  RunMeta,
  RunRequest,
  ResumeRequest,
  VarianceGroup,
  VarianceRequest,
  VarianceRunEvent,
} from './types'

/** Shapes the engine returns that the client narrows before handing on. */
interface WorkspaceResponse {
  chains?: RawChain[]
  capabilities?: Capabilities
}

/** The workspace as this plugin reads it: what it can run, and what the engine can do. */
export interface Workspace {
  chains: ChainSummary[]
  capabilities: Capabilities
}

interface RawChain {
  slug: string
  name: string
  description?: string
  moment?: string
  purpose?: ChainSummary['purpose']
  /** The engine's parameter also names the node it feeds; the picker does not need that. */
  parameter?: { name: string; options: string[]; node?: string }
  view?: string
  outputs?: ChainPort[]
  /** The chain's graph. Only the node kinds are read, to see whether it takes a seed. */
  nodes?: { kind?: string }[]
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/**
 * What `ping` asks for: a run id nothing matches, answered from one failed file
 * read. `/api/workspace` would serialise the whole workspace every few seconds.
 */
const PROBE_PATH = '/api/runs/chain-runner-probe'

/**
 * The engine as this plugin sees it: a handful of calls, and a reachability check. The
 * base URL is read per call, so a settings change takes effect on the next one.
 * Every failure to reach it surfaces as `EngineOfflineError`.
 */
export class EngineClient {
  /** What the engine at `base` said it can do, kept so no action asks just to gate itself. */
  private known: { base: string; capabilities: Promise<Capabilities> } | undefined

  constructor(
    private readonly baseUrl: () => string,
    private readonly transport: HttpTransport,
  ) {}

  /**
   * The workspace, with the engine's account of what it supports, which is kept
   * for `capabilities`. One too old to report `capabilities` yields an empty one,
   * which supports nothing (ADR-0017).
   */
  async loadWorkspace(): Promise<Workspace> {
    const base = this.baseUrl()
    const workspace = await this.getJson<WorkspaceResponse>('/api/workspace')
    const capabilities = workspace.capabilities ?? {}
    this.known = { base, capabilities: Promise.resolve(capabilities) }
    return { chains: (workspace.chains ?? []).map(summarise), capabilities }
  }

  /** What the engine can do: as it last said, asked only when nothing is kept for this base URL. */
  capabilities(): Promise<Capabilities> {
    const base = this.baseUrl()
    if (this.known?.base === base) return this.known.capabilities
    const asked = this.loadWorkspace().then(workspace => workspace.capabilities)
    const known = { base, capabilities: asked }
    this.known = known
    // A failed question keeps nothing, so the next caller asks again.
    asked.catch(() => {
      if (this.known === known) this.known = undefined
    })
    return asked
  }

  /** Chains the workspace holds, narrowed to what the add-chain picker shows. */
  async listChains(): Promise<ChainSummary[]> {
    return (await this.loadWorkspace()).chains
  }

  async getRun(runId: string): Promise<RunMeta> {
    return this.getJson<RunMeta>(`/api/runs/${encodeURIComponent(runId)}`)
  }

  /** The run, if it waits at a hold, with the holds it reached; `undefined` for a run that does not. */
  async waitingRun(runId: string): Promise<RunMeta | undefined> {
    const waiting = await this.getJson<RunMeta[]>('/api/runs?status=waiting')
    return waiting.find(run => run.runId === runId)
  }

  /**
   * Whether the engine still has a run, for a note that says it came from one.
   * It answers instead of throwing: an unreachable engine is not a deleted run
   * (ADR-0004).
   */
  async runExists(runId: string): Promise<RunExistence> {
    try {
      await this.getRun(runId)
      return 'found'
    } catch (error) {
      if (error instanceof EngineHttpError && error.status === 404) return 'missing'
      return 'unknown'
    }
  }

  async getLayout(runId: string): Promise<LayoutModel> {
    return this.getJson<LayoutModel>(`/api/runs/${encodeURIComponent(runId)}/layout`)
  }

  async getVarianceGroup(groupId: string): Promise<VarianceGroup> {
    return this.getJson<VarianceGroup>(`/api/variance/${encodeURIComponent(groupId)}`)
  }

  /**
   * Starts a run and yields its events. An engine `error` event is yielded, not
   * thrown; only an unreachable engine or a rejected request throws.
   */
  async *launchRun(request: RunRequest, signal?: AbortSignal): AsyncGenerator<RunEvent> {
    yield* this.streamRun('/api/run', request, signal)
  }

  /** Starts a repeated chain run; each frame remains tagged with its member index. */
  async *launchVariance(request: VarianceRequest, signal?: AbortSignal): AsyncGenerator<VarianceRunEvent> {
    const url = this.resolve('/api/variance')
    const stream = await this.transport.open({
      url,
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(request),
      signal,
    })
    if (!ok(stream.status)) {
      throw new EngineHttpError(stream.status, url, await collect(stream.body))
    }
    for await (const payload of parseSse(stream.body)) {
      if (isVarianceRunEvent(payload)) yield payload
    }
  }

  async *forkRun(runId: string, request: ForkRequest, signal?: AbortSignal): AsyncGenerator<RunEvent> {
    yield* this.streamRun(`/api/runs/${encodeURIComponent(runId)}/fork`, request, signal)
  }

  /**
   * Answers the run's hold and carries it on, yielding the same events a run
   * does. A hold already answered forks instead, and the fork's id arrives as
   * `run_start`, so the caller must not assume the id it posted to. A refusal —
   * the run is running, the pick is not the hold's, no hold named — throws
   * `EngineHttpError` for the caller to name.
   */
  async *resumeRun(runId: string, request: ResumeRequest, signal?: AbortSignal): AsyncGenerator<RunEvent> {
    yield* this.streamRun(`/api/runs/${encodeURIComponent(runId)}/resume`, request, signal)
  }

  /**
   * Makes one of a node's chat replies its output, yielding the run events that
   * follow. The engine decides whether that reruns the run in place or forks a
   * new one, so the id in the stream's first `run_start` is the run of record —
   * never the id posted to (#53). A refusal — the node is in a loop, `turn` is
   * out of range, it is not a proposer, the run is running — throws
   * `EngineHttpError` for the caller to name.
   */
  async *promoteNode(node: { runId: string; nodeId: string }, request: PromoteRequest, signal?: AbortSignal): AsyncGenerator<RunEvent> {
    yield* this.streamRun(`/api/runs/${encodeURIComponent(node.runId)}/nodes/${encodeURIComponent(node.nodeId)}/promote`, request, signal)
  }

  /**
   * Continues one node's own transcript with `message`, yielding the chat
   * stream's own events. An engine `error` event is yielded, not thrown; a
   * refusal — the run is running, the node is unknown, it is not a proposer,
   * its agent file is gone — throws `EngineHttpError` for the caller to name.
   */
  async *chatWithNode(chat: { runId: string; nodeId: string; message: string }, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
    const url = this.resolve(`/api/runs/${encodeURIComponent(chat.runId)}/nodes/${encodeURIComponent(chat.nodeId)}/chat`)
    const stream = await this.transport.open({
      url,
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ message: chat.message }),
      signal,
    })
    if (!ok(stream.status)) {
      throw new EngineHttpError(stream.status, url, await collect(stream.body))
    }
    for await (const payload of parseSse(stream.body)) {
      if (isChatEvent(payload)) yield payload
    }
  }

  /** Whether the engine is there. One that answers with an error is still up. */
  async ping(signal?: AbortSignal): Promise<boolean> {
    let url: string
    try {
      url = this.resolve(PROBE_PATH)
    } catch {
      // A base URL that will not parse can never be reached either.
      return false
    }
    try {
      await this.transport.send({ url, signal })
      return true
    } catch (error) {
      if (error instanceof EngineOfflineError) return false
      throw error
    }
  }

  /** A POST whose answer is the run event stream. */
  private async *streamRun(path: string, request: unknown, signal?: AbortSignal): AsyncGenerator<RunEvent> {
    const url = this.resolve(path)
    const stream = await this.transport.open({
      url,
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(request),
      signal,
    })
    if (!ok(stream.status)) {
      throw new EngineHttpError(stream.status, url, await collect(stream.body))
    }
    for await (const payload of parseSse(stream.body)) {
      if (isRunEvent(payload)) yield payload
    }
  }

  private async getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    const url = this.resolve(path)
    const response = await this.request({ url, signal })
    return JSON.parse(response) as T
  }

  private async request(request: HttpRequest): Promise<string> {
    const { status, body } = await this.transport.send(request)
    if (!ok(status)) throw new EngineHttpError(status, request.url, body)
    return body
  }

  private resolve(path: string): string {
    return new URL(path, withTrailingSlash(this.baseUrl())).toString()
  }
}

function ok(status: number): boolean {
  return status >= 200 && status < 300
}

/** `new URL('/api/x', base)` needs a base it can parse; a bare origin is enough. */
function withTrailingSlash(base: string): string {
  return base.endsWith('/') ? base : `${base}/`
}

function summarise(chain: RawChain): ChainSummary {
  const summary: ChainSummary = { slug: chain.slug, name: chain.name }
  // An empty `description` is the same as none: there is nothing to fall back to.
  if (chain.description) summary.description = chain.description
  if (chain.moment !== undefined) summary.moment = chain.moment
  if (chain.purpose !== undefined) summary.purpose = chain.purpose
  if (chain.parameter) {
    summary.parameter = { name: chain.parameter.name, options: chain.parameter.options }
  }
  // A chain's layout is half `view` and half `outputs`; the result view needs both.
  const view = declaredView(chain.view)
  if (view !== undefined) summary.view = view
  if (chain.outputs !== undefined) summary.outputs = chain.outputs.map(summarisePort)
  if (chain.nodes !== undefined) summary.seeded = chain.nodes.some(node => node.kind === 'seed')
  return summary
}

/** A `view:` this plugin cannot draw is the same to it as none at all. */
function declaredView(view: string | undefined): ChainView | undefined {
  return view === 'timeline' || view === 'columns' || view === 'sidebar' ? view : undefined
}

/** A port arrives with keys the panels never read; copying keeps the summary comparable. */
function summarisePort(raw: ChainPort): ChainPort {
  const kept: ChainPort = { name: raw.name, node: raw.node }
  if (raw.socket !== undefined) kept.socket = raw.socket
  if (raw.role !== undefined) kept.role = raw.role
  return kept
}

/** The engine sends only tagged objects; anything else on the wire is not ours. */
function isRunEvent(payload: unknown): payload is RunEvent {
  return typeof payload === 'object' && payload !== null && typeof (payload as RunEvent).type === 'string'
}

/** Member frames carry an index; the one group frame names the completed group. */
function isVarianceRunEvent(payload: unknown): payload is VarianceRunEvent {
  if (typeof payload !== 'object' || payload === null) return false
  const event = payload as Record<string, unknown>
  if (event.type === 'variance_complete') {
    return typeof event.groupId === 'string' && Array.isArray(event.runIds)
  }
  return isRunEvent(payload) && Number.isInteger(event.instance) && (event.instance as number) >= 0
}

async function collect(chunks: AsyncIterable<string>): Promise<string> {
  let body = ''
  for await (const chunk of chunks) body += chunk
  return body
}
