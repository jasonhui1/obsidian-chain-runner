import { conversationStart, locatedTriggers } from './conversationTrigger'
import { joinSeed } from './seed'
import type { AgentOutput, RunMeta } from '../engine/types'

/**
 * The approximate chat with a proposer: a `@name message` line in the
 * Conversation section, and a bare `revise` that turns the reply above it into
 * that proposer's revision. Not the real thing — this is a fresh agent call
 * with the prior output pasted in, not the agent's own transcript continued.
 */

/** One `@name message` line, and its reply once there is one. */
export interface ChatTurn {
  name: string
  message: string
  reply?: string
}

const MESSAGE_LINE = /^@(\S+)\s+(.+)$/
const REVISE_LINE = /^revise$/i

export { conversationStart }

interface LocatedTurn extends ChatTurn {
  /** Offset in the full note right after the message line — where a reply is inserted. */
  insertAt: number
}

/** Every `@name message` line under Conversation, in order, positioned to insert a reply after. */
function locatedTurns(content: string): LocatedTurn[] {
  return locatedTriggers(content, MESSAGE_LINE, match => ({ name: match[1], message: match[2].trim() })).map(
    ({ fields, insertAt, reply }) => ({ ...fields, insertAt, ...(reply !== undefined ? { reply } : {}) }),
  )
}

/** The most recent `@name message` line with no reply below it yet, or undefined when there is none. */
export function pendingMessage(content: string): ChatTurn | undefined {
  const turns = locatedTurns(content)
  const last = turns[turns.length - 1]
  return last && last.reply === undefined ? { name: last.name, message: last.message } : undefined
}

/** The turn a trailing bare `revise` line refers to, or undefined when there is none to revise. */
export function pendingRevise(content: string): ChatTurn | undefined {
  const tail = content.slice(conversationStart(content)).trimEnd()
  const lastLine = tail.slice(tail.lastIndexOf('\n') + 1).trim()
  if (!REVISE_LINE.test(lastLine)) return undefined

  const turns = locatedTurns(content)
  const last = turns[turns.length - 1]
  return last?.reply !== undefined ? { name: last.name, message: last.message, reply: last.reply } : undefined
}

/** The reply inserted as a blockquote right under the message it answers; unchanged if that turn is gone. */
export function appendChatReply(content: string, turn: { name: string; message: string }, reply: string): string {
  const found = locatedTurns(content).find(t => t.name === turn.name && t.message === turn.message && t.reply === undefined)
  if (!found) return content
  const block =
    reply
      .trim()
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n') + '\n'
  return content.slice(0, found.insertAt) + block + content.slice(found.insertAt)
}

/** The trailing bare `revise` replaced with which run it produced, so it is not acted on twice. */
export function markRevised(content: string, runId: string): string {
  return content.replace(/revise\s*$/i, `revise → reran as run ${runId}\n`)
}

/** Last write wins, matching how the engine resolves a node's outputs. */
export function latestOutput(outputs: AgentOutput[], nodeId: string): AgentOutput | undefined {
  let found: AgentOutput | undefined
  for (const output of outputs) if (output.nodeId === nodeId) found = output
  return found
}

/**
 * The seed for a standalone call to `nodeId`'s agent: what fed it last time, what
 * it answered last time, and the human's new message. `undefined` when the run
 * carries no graph, or never actually produced an output for this node.
 */
export function chatSeed(run: RunMeta, nodeId: string, message: string): string | undefined {
  const graph = run.graph
  if (!graph) return undefined
  const previous = latestOutput(run.agentOutputs, nodeId)
  if (!previous) return undefined

  const inputs = graph.edges
    .filter(edge => edge.toNode === nodeId)
    .map(edge => latestOutput(run.agentOutputs, edge.fromNode)?.output)
    .filter((text): text is string => text !== undefined)

  return joinSeed([...inputs, previous.output, message])
}
