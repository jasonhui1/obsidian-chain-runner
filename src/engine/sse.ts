/**
 * Server-sent-event framing, reduced to what the run API sends: `data:` frames
 * holding one JSON value each. Any byte source will do.
 */

const FRAME_SEPARATOR = /\r?\n\r?\n/

/** The JSON value of one frame, or `undefined` when the frame carried no usable data. */
function payloadOf(frame: string): unknown {
  const data = frame
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice('data:'.length).replace(/^ /, ''))
    .join('\n')
  if (data === '') return undefined
  try {
    return JSON.parse(data)
  } catch {
    // A frame the engine did not mean as JSON is noise, not the end of the run.
    return undefined
  }
}

export async function* parseSse(source: AsyncIterable<string>): AsyncGenerator<unknown> {
  let buffer = ''
  for await (const chunk of source) {
    buffer += chunk
    for (;;) {
      const match = FRAME_SEPARATOR.exec(buffer)
      if (!match) break
      const frame = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      const payload = payloadOf(frame)
      if (payload !== undefined) yield payload
    }
  }
  // A stream closed straight after its last frame never sends the blank line.
  const tail = payloadOf(buffer)
  if (tail !== undefined) yield tail
}
