/**
 * The one place the plugin touches the network. Node's `http` directly:
 * `requestUrl` cannot stream a body, and a renderer `fetch` to `localhost` is a
 * cross-origin request the engine sets no CORS headers for.
 */

export interface HttpRequest {
  url: string
  method?: 'GET' | 'POST' | 'PATCH'
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}

export interface HttpResponse {
  status: number
  body: string
}

export interface HttpStream {
  status: number
  /** Decoded response body, chunk by chunk as it arrives. */
  body: AsyncIterable<string>
}

export interface HttpTransport {
  /** Reads the whole response before resolving. */
  send(request: HttpRequest): Promise<HttpResponse>
  /** Resolves once the headers are in; the body arrives afterwards. */
  open(request: HttpRequest): Promise<HttpStream>
}

/**
 * The engine could not be reached at all — refused, unresolvable, timed out.
 * This is what flips the status pill offline; an HTTP error does not.
 */
export class EngineOfflineError extends Error {
  constructor(
    readonly url: string,
    /** Node's own error, kept for logging; `cause` is taken by `Error`. */
    readonly reason?: unknown,
  ) {
    super(`engine unreachable at ${url}`)
    this.name = 'EngineOfflineError'
  }
}

/** The engine answered, and said no. */
export class EngineHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`engine returned ${status} for ${url}`)
    this.name = 'EngineHttpError'
  }
}

/** Aborting a request is the caller's own doing, not an engine fault. */
export class RequestAbortedError extends Error {
  constructor(readonly url: string) {
    super(`request aborted: ${url}`)
    this.name = 'RequestAbortedError'
  }
}
