import http from 'node:http'
import type { AddressInfo } from 'node:net'

export interface RecordedRequest {
  method: string
  path: string
  body: string
}

/**
 * A stand-in for maestro-playground, spoken to over a real socket so the client
 * is exercised through its real transport. Routes are the engine's own: the
 * workspace listing, a run's meta and layout, and `POST /api/run` streaming SSE.
 */
export class FakeEngine {
  private readonly server: http.Server
  readonly requests: RecordedRequest[] = []

  /** Frames `POST /api/run` writes, in order. `null` closes the stream. */
  runFrames: (string | null)[] = []
  chains: unknown[] = []
  /** What the engine says it can do; a version too old to say reports nothing. */
  capabilities: unknown = { runLayoutFrames: true }
  runMeta: unknown = {}
  layout: unknown = { kind: 'undeclared', panels: [] }
  /** When set, every route answers with this status and body instead. */
  failWith?: { status: number; body: string }

  private constructor() {
    this.server = http.createServer((req, res) => this.route(req, res))
  }

  static async start(): Promise<FakeEngine> {
    const engine = new FakeEngine()
    await new Promise<void>(resolve => engine.server.listen(0, '127.0.0.1', resolve))
    return engine
  }

  get url(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections()
    await new Promise<void>(resolve => this.server.close(() => resolve()))
  }

  private route(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      const path = req.url ?? ''
      this.requests.push({ method: req.method ?? 'GET', path, body })

      if (this.failWith) {
        res.writeHead(this.failWith.status)
        res.end(this.failWith.body)
      } else if (req.method === 'POST' && path === '/api/run') {
        this.streamRun(res)
      } else if (path === '/api/workspace') {
        this.json(res, { chains: this.chains, agents: [], capabilities: this.capabilities })
      } else if (path.endsWith('/layout')) {
        this.json(res, this.layout)
      } else if (path.startsWith('/api/runs/')) {
        this.json(res, this.runMeta)
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    })
  }

  private json(res: http.ServerResponse, value: unknown): void {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(value))
  }

  private streamRun(res: http.ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const frame of this.runFrames) {
      if (frame === null) {
        res.end()
        return
      }
      res.write(frame)
    }
    res.end()
  }
}

/** One SSE frame carrying `value` as its JSON data, framed the way the engine frames it. */
export function frame(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`
}
