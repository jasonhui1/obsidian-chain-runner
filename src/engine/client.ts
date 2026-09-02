import { parseSse } from './sse'
import {
  EngineHttpError,
  EngineOfflineError,
  type HttpRequest,
  type HttpTransport,
} from './transport'
import type { ChainPort, ChainSummary, LayoutModel, RunEvent, RunMeta, RunRequest } from './types'

/** Shapes the engine returns that the client narrows before handing on. */
interface WorkspaceResponse {
  chains?: RawChain[]
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
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/**
 * What `ping` asks for. `/api/workspace` would answer too, but it reads and
 * serialises every agent, skill, chain, tool and template on disk — too much to
 * repeat every few seconds. A run id nothing can match is answered from a
 * single failed file read, and the answer's status does not matter: any reply
 * at all means the engine is there.
 */
const PROBE_PATH = '/api/runs/chain-runner-probe'

/**
 * The engine as this plugin sees it: four calls, and a reachability check.
 *
 * The base URL is read per call rather than captured, so changing it in
 * settings takes effect on the next request with nothing to re-wire. Every
 * failure to reach the engine surfaces as `EngineOfflineError`, which is the
 * single condition the status pill and the offline guard react to.
 */
export class EngineClient {
  constructor(
    private readonly baseUrl: () => string,
    private readonly transport: HttpTransport,
  ) {}

  /** Chains the workspace holds, narrowed to what the add-chain picker shows. */
  async listChains(): Promise<ChainSummary[]> {
    const workspace = await this.getJson<WorkspaceResponse>('/api/workspace')
    return (workspace.chains ?? []).map(summarise)
  }

  async getRun(runId: string): Promise<RunMeta> {
    return this.getJson<RunMeta>(`/api/runs/${encodeURIComponent(runId)}`)
  }

  async getLayout(runId: string): Promise<LayoutModel> {
    return this.getJson<LayoutModel>(`/api/runs/${encodeURIComponent(runId)}/layout`)
  }

  /**
   * Starts a run and yields its events as they arrive. An engine `error` event
   * is yielded, not thrown — the run reached the engine and the engine has
   * something to say. Only an unreachable engine or a rejected request throws.
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

  /**
   * Whether the engine is there. An engine that answers with an error is still
   * up — only an unreachable one is offline, so a broken workspace does not
   * read as a stopped server.
   */
  async ping(signal?: AbortSignal): Promise<boolean> {
    let url: string
    try {
      url = this.resolve(PROBE_PATH)
    } catch {
      // A base URL that will not parse can never be reached either; the settings
      // tab is where that gets fixed, not a thrown poll.
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
  // Every chain carries a `description`; an empty one is the same as none to the
  // picker, which falls back to it only when there is something to fall back to.
  if (chain.description) summary.description = chain.description
  if (chain.moment !== undefined) summary.moment = chain.moment
  if (chain.purpose !== undefined) summary.purpose = chain.purpose
  if (chain.parameter) {
    summary.parameter = { name: chain.parameter.name, options: chain.parameter.options }
  }
  // A chain's layout is half `view` and half `outputs`; the result view needs both
  // to draw the panels the engine would draw for the same run.
  if (chain.view !== undefined) summary.view = chain.view
  if (chain.outputs !== undefined) summary.outputs = chain.outputs.map(port)
  return summary
}

/** A port arrives with keys the panels never read; copying keeps the summary comparable. */
function port(raw: ChainPort): ChainPort {
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
