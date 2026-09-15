import { appendToConversation, conversationStart, locatedTriggers, quoted } from './conversationTrigger'
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

/** A chat turn as the Conversation reads back, with the run its reply was revised as. */
export interface ChatEntry extends ChatTurn {
  revisedAs?: string
}

const MESSAGE_LINE = /^@(\S+)\s+(.+)$/
const REVISE_LINE = /^revise$/i
const revisedLine = (runId: string): string => `revise → reran as run ${runId}`
const REVISED_LINE = /^revise → reran as run (\S+)$/

export { conversationStart }

interface LocatedTurn extends ChatEntry {
  /** Offset in the full note right after the message line — where a reply is inserted. */
  insertAt: number
  /** Offset right after the reply — where a revised line goes. */
  end: number
}

/** Every `@name message` line under Conversation, in order, positioned to insert a reply after. */
function locatedTurns(content: string): LocatedTurn[] {
  return locatedTriggers(content, MESSAGE_LINE, match => ({ name: match[1], message: match[2].trim() })).map(
    ({ fields, insertAt, end, reply }) => {
      const revisedAs = REVISED_LINE.exec(content.slice(end, lineEnd(content, end)).trim())?.[1]
      return { ...fields, insertAt, end, ...(reply !== undefined ? { reply } : {}), ...(revisedAs ? { revisedAs } : {}) }
    },
  )
}

/** Every chat turn under Conversation, in order, each with where it sits in the note. */
export function chatEntries(content: string): { entry: ChatEntry; at: number }[] {
  return locatedTurns(content).map(({ name, message, reply, revisedAs, insertAt }) => ({
    entry: { name, message, ...(reply !== undefined ? { reply } : {}), ...(revisedAs ? { revisedAs } : {}) },
    at: insertAt,
  }))
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
  return content.slice(0, found.insertAt) + quoted(reply) + '\n' + content.slice(found.insertAt)
}

/** A message and its reply written together, as the Conversation's last entry. */
export function appendChatTurn(content: string, turn: { name: string; message: string }, reply: string): string {
  return appendToConversation(content, `@${turn.name} ${turn.message}\n${quoted(reply)}`)
}

/** The trailing bare `revise` replaced with which run it produced, so it is not acted on twice. */
export function markRevised(content: string, runId: string): string {
  return content.replace(/revise\s*$/i, `${revisedLine(runId)}\n`)
}

/** The last such turn not yet revised, marked as revised into `runId`; unchanged when there is none. */
export function markTurnRevised(content: string, turn: Required<ChatTurn>, runId: string): string {
  const found = locatedTurns(content)
    .filter(t => t.name === turn.name && t.message === turn.message && t.reply === turn.reply && !t.revisedAs)
    .at(-1)
  if (!found) return content
  const at = Math.min(found.end, content.length)
  const before = content.slice(0, at)
  return `${before}${before.endsWith('\n') ? '' : '\n'}${revisedLine(runId)}\n${content.slice(at)}`
}

function lineEnd(content: string, at: number): number {
  const newline = content.indexOf('\n', at)
  return newline === -1 ? content.length : newline
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
