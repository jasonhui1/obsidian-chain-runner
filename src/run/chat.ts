import { appendToConversation, conversationStart, lineEnd, locatedTriggers, quoted } from './conversationTrigger'
import { joinSeed } from './seed'
import type { AgentOutput, RunMeta } from '../engine/types'

/**
 * Chat with a proposer as the hold note writes it: a `@name message` line in
 * the Conversation section, the reply quoted under it, and a bare `revise` that
 * turns that reply into the proposer's revision. A reply the engine's chat
 * endpoint gave carries its turn number on a `[turn N]` line of its own at the
 * top of the quote — that is where the note remembers it, so nothing has to be
 * matched back against the transcript later (#49). `./proposerChat.ts` is the
 * call; `chatSeed` below is the approximate chat it falls back to.
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
  /** Which turn of the node's transcript the reply is, 1-based; absent on an approximate reply. */
  turn?: number
}

/** A proposer's answer, and which turn of its transcript that answer was. */
export interface ChatReply {
  text: string
  turn?: number
}

const MESSAGE_LINE = /^@(\S+)\s+(.+)$/
const TURN_LINE = /^\[turn (\d+)\]$/
const REVISE_LINE = /^revise$/i
const REVISED = 'revise → reran as run '
const REVISED_LINE = new RegExp(`^${REVISED}(\\S+)$`)

export { conversationStart }

interface LocatedTurn {
  entry: ChatEntry
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
      const answered = reply === undefined ? {} : readReply(reply)
      return { entry: { ...fields, ...answered, ...(revisedAs ? { revisedAs } : {}) }, insertAt, end }
    },
  )
}

/** A quoted reply split from the `[turn N]` line the note wrote above it, when it has one. */
function readReply(quote: string): { reply: string; turn?: number } {
  const newline = quote.indexOf('\n')
  const turn = TURN_LINE.exec((newline === -1 ? quote : quote.slice(0, newline)).trim())?.[1]
  if (turn === undefined) return { reply: quote }
  return { reply: quote.slice(newline === -1 ? quote.length : newline + 1).replace(/^\s*\n/, ''), turn: Number(turn) }
}

/** A reply as it is written under its message: its turn number first, when the engine gave it one. */
function replyBlock(reply: ChatReply): string {
  return quoted(reply.turn === undefined ? reply.text : `[turn ${reply.turn}]\n\n${reply.text}`)
}

/** Every chat turn under Conversation, in order, each with where it sits in the note. */
export function chatEntries(content: string): { entry: ChatEntry; at: number }[] {
  return locatedTurns(content).map(({ entry, insertAt }) => ({ entry, at: insertAt }))
}

/** The same message, answered with the same reply. */
export function sameTurn(a: ChatTurn, b: ChatTurn): boolean {
  return a.name === b.name && a.message === b.message && a.reply === b.reply
}

/** The most recent `@name message` line with no reply below it yet, or undefined when there is none. */
export function pendingMessage(content: string): ChatTurn | undefined {
  const turns = locatedTurns(content)
  const last = turns[turns.length - 1]?.entry
  return last && last.reply === undefined ? { name: last.name, message: last.message } : undefined
}

/** The turn a trailing bare `revise` line refers to, or undefined when there is none to revise. */
export function pendingRevise(content: string): ChatTurn | undefined {
  const tail = content.slice(conversationStart(content)).trimEnd()
  const lastLine = tail.slice(tail.lastIndexOf('\n') + 1).trim()
  if (!REVISE_LINE.test(lastLine)) return undefined

  const turns = locatedTurns(content)
  const last = turns[turns.length - 1]?.entry
  return last?.reply !== undefined ? { name: last.name, message: last.message, reply: last.reply } : undefined
}

/** The reply inserted as a blockquote right under the message it answers; unchanged if that turn is gone. */
export function appendChatReply(content: string, turn: { name: string; message: string }, reply: ChatReply): string {
  const found = locatedTurns(content).find(t => sameTurn(t.entry, turn))
  if (!found) return content
  return content.slice(0, found.insertAt) + replyBlock(reply) + '\n' + content.slice(found.insertAt)
}

/** A message and its reply written together, as the Conversation's last entry. */
export function appendChatTurn(content: string, turn: { name: string; message: string }, reply: ChatReply): string {
  return appendToConversation(content, `@${turn.name} ${turn.message}\n${replyBlock(reply)}`)
}

/** The trailing bare `revise` replaced with which run it produced, so it is not acted on twice. */
export function markRevised(content: string, runId: string): string {
  return content.replace(/revise\s*$/i, `${REVISED}${runId}\n`)
}

/** The last such turn not yet revised, marked as revised into `runId`; unchanged when there is none. */
export function markTurnRevised(content: string, turn: Required<ChatTurn>, runId: string): string {
  const found = locatedTurns(content)
    .filter(t => sameTurn(t.entry, turn) && !t.entry.revisedAs)
    .at(-1)
  if (!found) return content
  const at = Math.min(found.end, content.length)
  const before = content.slice(0, at)
  return `${before}${before.endsWith('\n') ? '' : '\n'}${REVISED}${runId}\n${content.slice(at)}`
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
