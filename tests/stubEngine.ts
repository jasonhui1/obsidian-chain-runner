import type { EngineClient } from '@/engine/client'
import type { StreamEvent } from '@/run/answer'
import type { Capabilities } from '@/engine/types'

/** Every call that answers with a stream: run, resume, promote and chat. */
const STREAMING = ['launchRun', 'resumeRun', 'promoteNode', 'chatWithNode'] as const

function engineWhere(capabilities: Capabilities, call: (first: unknown) => AsyncIterable<StreamEvent>): EngineClient {
  const engine: Record<string, unknown> = { capabilities: () => Promise.resolve(capabilities) }
  for (const name of STREAMING) engine[name] = call
  return engine as unknown as EngineClient
}

/** An engine whose every streaming call yields `events`, keeping what each was first called with in `called`. */
export function streamingEngine(events: StreamEvent[], capabilities: Capabilities = {}, called: unknown[] = []): EngineClient {
  return engineWhere(capabilities, async function* (first) {
    called.push(first)
    yield* events
  })
}

/** An engine whose every streaming call throws `thrown` before streaming anything. */
export function refusingEngine(thrown: unknown, capabilities: Capabilities = {}): EngineClient {
  return engineWhere(capabilities, () => {
    throw thrown
  })
}

/** An engine answering only the calls a test names, as the test answers them. */
export function stubEngine(calls: Partial<Record<keyof EngineClient, unknown>>): EngineClient {
  return calls as unknown as EngineClient
}
