import { parseSse } from './sse'
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
  LayoutModel,
  RunEvent,
  RunExistence,
  RunMeta,
  RunRequest,
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
 * The engine as this plugin sees it: four calls, and a reachability check. The
 * base URL is read per call, so a settings change takes effect on the next one.
 * Every failure to reach it surfaces as `EngineOfflineError`.
 */
export class EngineClient {
  constructor(
    private readonly baseUrl: () => string,
    private readonly transport: HttpTransport,
  ) {}

  /**
   * The workspace, with the engine's account of what it supports. One too old to
   * report `capabilities` yields an empty one, which supports nothing (ADR-0017).
   */
  async loadWorkspace(): Promise<Workspace> {
    const workspace = await this.getJson<WorkspaceResponse>('/api/workspace')
    return {
      chains: (workspace.chains ?? []).map(summarise),
      capabilities: workspace.capabilities ?? {},
    }
  }

  /** Chains the workspace holds, narrowed to what the add-chain picker shows. */
  async listChains(): Promise<ChainSummary[]> {
    return (await this.loadWorkspace()).chains
  }

  async getRun(runId: string): Promise<RunMeta> {
    return this.getJson<RunMeta>(`/api/runs/${encodeURIComponent(runId)}`)
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

  /**
   * Starts a run and yields its events. An engine `error` event is yielded, not
   * thrown; only an unreachable engine or a rejected request throws.
   */
  async *launchRun(request: RunRequest, signal?: AbortSignal): AsyncGenerator<RunEvent> {
    const url = this.resolve('/api/run')
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

async function collect(chunks: AsyncIterable<string>): Promise<string> {
  let body = ''
  for await (const chunk of chunks) body += chunk
  return body
}
