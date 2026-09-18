import { answer, type Answer } from './answer'
import { latestOutput } from './chat'
import type { EngineClient } from '../engine/client'
import type { AgentOutput } from '../engine/types'

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

export const UNSUPPORTED_CHAT = 'This engine cannot chat with a proposer. Update maestro-playground.'

/** The engine turns already on a node: the assistant replies its transcript holds. */
export function repliesSoFar(outputs: AgentOutput[], nodeId: string): number {
  return (latestOutput(outputs, nodeId)?.conversation ?? []).filter(message => message.role === 'assistant').length
}

/**
 * One turn of the node's own transcript, its words the answer's `reply`. Every
 * refusal comes back as text to show, never a throw — `unsupported` where the
 * approximate chat takes over; only an unreachable engine still throws.
 */
export function chatReply(engine: EngineClient, chat: ProposerChat): Promise<Answer> {
  const { runId, nodeId, name, message } = chat
  return answer(engine, {
    open: () => engine.chatWithNode({ runId, nodeId, message }),
    refusals: {
      // The node comes from the run's own layout, so a 404 from an engine that
      // never claimed the endpoint is the route missing, not the node (#54).
      endpoint: 'proposerChat',
      unsupported: UNSUPPORTED_CHAT,
      running: () => `Run ${runId} is still running — chat with ${name} once it stops`,
      gone: `Run ${runId} no longer has a node for ${name}`,
      invalid: said => `${name} cannot be chatted with: ${said}`,
      unprocessable: `${name}'s agent file is gone from the workspace`,
    },
  })
}
