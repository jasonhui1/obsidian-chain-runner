import { describe, it, expect } from 'vitest'
import { parseSse } from '@/engine/sse'

async function* chunks(...parts: string[]): AsyncGenerator<string> {
  for (const part of parts) yield part
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of source) out.push(item)
  return out
}

describe('parseSse', () => {
  it('yields one payload per data frame', async () => {
    const got = await collect(parseSse(chunks('data: {"a":1}\n\n', 'data: {"a":2}\n\n')))
    expect(got).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('reassembles a frame split across chunk boundaries', async () => {
    const got = await collect(parseSse(chunks('data: {"tok', 'en":"he', 'llo"}\n\n')))
    expect(got).toEqual([{ token: 'hello' }])
  })

  it('splits a chunk that carries several frames', async () => {
    const got = await collect(parseSse(chunks('data: 1\n\ndata: 2\n\ndata: 3\n\n')))
    expect(got).toEqual([1, 2, 3])
  })

  it('joins a frame whose data spans several lines', async () => {
    const got = await collect(parseSse(chunks('data: {"a":\ndata: 1}\n\n')))
    expect(got).toEqual([{ a: 1 }])
  })

  it('ignores comments, other fields, and blank padding', async () => {
    const got = await collect(parseSse(chunks(': keep-alive\n\nevent: ping\nid: 7\n\ndata: {"a":1}\n\n')))
    expect(got).toEqual([{ a: 1 }])
  })

  it('tolerates CRLF line endings', async () => {
    const got = await collect(parseSse(chunks('data: {"a":1}\r\n\r\n')))
    expect(got).toEqual([{ a: 1 }])
  })

  it('flushes a trailing frame the stream ended without blank-line terminating', async () => {
    const got = await collect(parseSse(chunks('data: {"a":1}\n')))
    expect(got).toEqual([{ a: 1 }])
  })

  it('skips a frame whose data is not JSON rather than ending the stream', async () => {
    const got = await collect(parseSse(chunks('data: not json\n\ndata: {"a":1}\n\n')))
    expect(got).toEqual([{ a: 1 }])
  })
})
