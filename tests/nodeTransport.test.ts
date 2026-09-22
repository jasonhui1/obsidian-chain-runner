import { describe, it, expect, afterEach, vi } from 'vitest'
import dns from 'node:dns'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createNodeTransport } from '@/engine/nodeTransport'
import { EngineOfflineError, RequestAbortedError } from '@/engine/transport'

let server: http.Server | undefined

async function listen(handler: http.RequestListener): Promise<string> {
  server = http.createServer(handler)
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
  server = undefined
})

const transport = createNodeTransport()

describe('nodeTransport.send', () => {
  it('returns the status and whole body', async () => {
    const base = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    })
    expect(await transport.send({ url: `${base}/api/workspace` })).toEqual({ status: 200, body: '{"ok":true}' })
  })

  it('reports a non-2xx status rather than throwing', async () => {
    const base = await listen((_req, res) => {
      res.writeHead(404)
      res.end('Run not found')
    })
    expect(await transport.send({ url: `${base}/api/runs/nope` })).toEqual({ status: 404, body: 'Run not found' })
  })

  it('sends the method, headers, and body it was given', async () => {
    let seen: { method?: string; contentType?: string; body: string } | undefined
    const base = await listen((req, res) => {
      let body = ''
      req.on('data', c => (body += c))
      req.on('end', () => {
        seen = { method: req.method, contentType: req.headers['content-type'], body }
        res.end('ok')
      })
    })
    await transport.send({
      url: `${base}/api/run`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"chainName":"five-personas"}',
    })
    expect(seen).toEqual({
      method: 'POST',
      contentType: 'application/json',
      body: '{"chainName":"five-personas"}',
    })
  })

  it('throws EngineOfflineError when the connection is refused', async () => {
    // Bind a port, then release it, so nothing is listening on a port we know.
    const base = await listen((_req, res) => res.end())
    await new Promise<void>(resolve => server!.close(() => resolve()))
    server = undefined
    await expect(transport.send({ url: `${base}/api/workspace` })).rejects.toBeInstanceOf(EngineOfflineError)
  })

  it('translates a DNS lookup failure to EngineOfflineError', async () => {
    const mockLookup = ((_hostname: string, options: unknown, callback?: unknown) => {
      const done = (typeof options === 'function' ? options : callback) as (
        error: NodeJS.ErrnoException | null,
        address: string,
        family: number,
      ) => void
      queueMicrotask(() => done(Object.assign(new Error('mocked lookup failure'), { code: 'ENOTFOUND' }), '', 4))
    }) as typeof dns.lookup
    const lookup = vi.spyOn(dns, 'lookup').mockImplementation(mockLookup)
    try {
      await expect(transport.send({ url: 'http://engine.invalid:3000/api/workspace' })).rejects.toBeInstanceOf(EngineOfflineError)
    } finally {
      lookup.mockRestore()
    }
  })

  it('throws RequestAbortedError when the caller aborts', async () => {
    const base = await listen(() => {
      /* never responds */
    })
    const controller = new AbortController()
    const pending = transport.send({ url: `${base}/api/workspace`, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(RequestAbortedError)
  })

  it('throws RequestAbortedError when the signal is already aborted', async () => {
    const base = await listen((_req, res) => res.end('unused'))
    await expect(
      transport.send({ url: `${base}/api/workspace`, signal: AbortSignal.abort() }),
    ).rejects.toBeInstanceOf(RequestAbortedError)
  })
})

describe('nodeTransport.open', () => {
  it('resolves on headers and yields body chunks as they arrive', async () => {
    let release: (() => void) | undefined
    const base = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: one\n\n')
      release = () => {
        res.write('data: two\n\n')
        res.end()
      }
    })
    const stream = await transport.open({ url: `${base}/api/run`, method: 'POST', body: '{}' })
    expect(stream.status).toBe(200)

    const seen: string[] = []
    const iterator = stream.body[Symbol.asyncIterator]()
    seen.push((await iterator.next()).value as string)
    expect(seen).toEqual(['data: one\n\n'])

    release!()
    for (;;) {
      const next = await iterator.next()
      if (next.done) break
      seen.push(next.value as string)
    }
    expect(seen.join('')).toBe('data: one\n\ndata: two\n\n')
  })

  it('throws EngineOfflineError when the connection is refused', async () => {
    const base = await listen((_req, res) => res.end())
    await new Promise<void>(resolve => server!.close(() => resolve()))
    server = undefined
    await expect(transport.open({ url: `${base}/api/run`, method: 'POST' })).rejects.toBeInstanceOf(EngineOfflineError)
  })

  it('stops the stream when the caller aborts mid-body', async () => {
    const base = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: one\n\n')
    })
    const controller = new AbortController()
    const stream = await transport.open({ url: `${base}/api/run`, signal: controller.signal })
    const iterator = stream.body[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toBe('data: one\n\n')
    controller.abort()
    await expect(iterator.next()).rejects.toBeInstanceOf(RequestAbortedError)
  })
})
