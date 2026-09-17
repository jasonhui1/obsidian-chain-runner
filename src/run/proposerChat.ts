import { engineFailureMessage, engineSaid } from '../engine/guard'
import { EngineHttpError } from '../engine/transport'
import { latestOutput } from './chat'
import type { EngineClient } from '../engine/client'
import type { AgentOutput, Capabilities } from '../engine/types'

/**
 * The real chat with a proposer: the engine continues that node's own
 * transcript. `./chat.ts` is the note the turns land in, and the approximate
 * chat this falls back to on an engine without the endpoint.
 */

/** One message to one node, named as the note names it. */
export interface ProposerChat {
  runId: string
  nodeId: string
  /** The proposal's name, which every refusal says. */
  name: string
  message: string
}

/** What came back: the proposer's words, a reason there are none, or an engine that cannot be asked. */
export type ChatOutcome =
  | { kind: 'reply'; text: string }
  | { kind: 'refused'; said: string }
  | { kind: 'unsupported' }

/**
 * Whether the engine has the chat endpoint: `undefined` on one too old to say,
 * which only the call itself can find out (ADR-0017, #54).
 */
export function chatsWithNodes(capabilities: Capabilities): boolean | undefined {
  return capabilities.proposerChat
}

/** The engine turns already on a node: the assistant replies its transcript holds. */
export function repliesSoFar(outputs: AgentOutput[], nodeId: string): number {
  return (latestOutput(outputs, nodeId)?.conversation ?? []).filter(message => message.role === 'assistant').length
}

/**
 * One turn of the node's own transcript. Every refusal comes back as text to
 * show, never a throw; only an unreachable engine still throws.
 */
export async function chatReply(engine: EngineClient, capabilities: Capabilities, chat: ProposerChat): Promise<ChatOutcome> {
  if (chatsWithNodes(capabilities) === false) return { kind: 'unsupported' }
  try {
    let outcome: ChatOutcome = { kind: 'refused', said: `Chat with ${chat.name} produced no reply` }
    for await (const event of engine.chatWithNode({ runId: chat.runId, nodeId: chat.nodeId, message: chat.message })) {
      if (event.type === 'chat_done') outcome = { kind: 'reply', text: event.message.content }
      if (event.type === 'error') outcome = { kind: 'refused', said: `Chat with ${chat.name} failed: ${event.error}` }
    }
    return outcome
  } catch (error) {
    if (!(error instanceof EngineHttpError)) throw error
    // The node comes from the run's own layout, so a 404 from an engine that
    // never claimed the endpoint is the route missing, not the node (#54).
    if (error.status === 404 && chatsWithNodes(capabilities) === undefined) return { kind: 'unsupported' }
    return { kind: 'refused', said: refusal(error, chat) }
  }
}

function refusal(error: EngineHttpError, chat: ProposerChat): string {
  if (error.status === 409) return `Run ${chat.runId} is still running — chat with ${chat.name} once it stops`
  if (error.status === 404) return `Run ${chat.runId} no longer has a node for ${chat.name}`
  if (error.status === 400) return `${chat.name} cannot be chatted with: ${engineSaid(error)}`
  if (error.status === 422) return `${chat.name}'s agent file is gone from the workspace`
  return engineFailureMessage(error) ?? `Chat with ${chat.name} failed`
}
