import http from 'node:http'
import https from 'node:https'
import type { IncomingMessage, ClientRequest } from 'node:http'
import {
  EngineOfflineError,
  RequestAbortedError,
  type HttpRequest,
  type HttpResponse,
  type HttpStream,
  type HttpTransport,
} from './transport'

/**
 * Node's client reports a refused connection, an unresolvable host and a
 * dropped socket all as request-level `error` events. To this plugin they are
 * one condition: the engine is not there — unless the caller pulled the socket
 * itself, which surfaces as the same kind of event.
 */
function failure(request: HttpRequest, cause: unknown): Error {
  if (cause instanceof RequestAbortedError || request.signal?.aborted) {
    return new RequestAbortedError(request.url)
  }
  return new EngineOfflineError(request.url, cause)
}

function dispatch(request: HttpRequest): ClientRequest {
  const url = new URL(request.url)
  const agent = url.protocol === 'https:' ? https : http
  return agent.request(url, {
    method: request.method ?? 'GET',
    headers: request.headers,
  })
}

/**
 * Opens the request and resolves once the response headers are in, leaving the
 * body unread so both callers below can decide what to do with it.
 *
 * Aborting has two shapes depending on when it lands: before headers there is
 * only a request to destroy, after them the body is the live stream and
 * destroying that is what makes the reader throw. Both are wired here so the
 * signal means the same thing throughout the exchange.
 */
function connect(request: HttpRequest): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (request.signal?.aborted) {
      reject(new RequestAbortedError(request.url))
      return
    }
    const req = dispatch(request)
    let response: IncomingMessage | undefined
    const onAbort = () => {
      const aborted = new RequestAbortedError(request.url)
      if (response) response.destroy(aborted)
      else req.destroy(aborted)
    }
    request.signal?.addEventListener('abort', onAbort, { once: true })

    req.on('response', res => {
      response = res
      // The body is consumed as an async iterator, which surfaces the error
      // there; this listener only keeps Node from treating it as unhandled
      // before the reader arrives.
      res.on('error', () => {})
      resolve(res)
    })
    req.on('error', error => {
      request.signal?.removeEventListener('abort', onAbort)
      // After the headers are in, the body carries the failure; a request-level
      // error here would otherwise reject an already-settled promise.
      if (!response) reject(failure(request, error))
    })
    if (request.body !== undefined) req.write(request.body)
    req.end()
  })
}

/** The body as text, with a socket failure translated on the way out. */
function decoded(res: IncomingMessage, request: HttpRequest): AsyncIterable<string> {
  res.setEncoding('utf8')
  return {
    async *[Symbol.asyncIterator]() {
      try {
        for await (const chunk of res) yield chunk as string
      } catch (error) {
        throw failure(request, error)
      }
    },
  }
}

export function createNodeTransport(): HttpTransport {
  return {
    async send(request: HttpRequest): Promise<HttpResponse> {
      const res = await connect(request)
      let body = ''
      for await (const chunk of decoded(res, request)) body += chunk
      return { status: res.statusCode ?? 0, body }
    },

    async open(request: HttpRequest): Promise<HttpStream> {
      const res = await connect(request)
      return { status: res.statusCode ?? 0, body: decoded(res, request) }
    },
  }
}
