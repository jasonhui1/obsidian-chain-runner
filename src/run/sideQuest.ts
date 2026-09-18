import { appendToConversation, locatedTriggers, quoted, type LocatedTrigger } from './conversationTrigger'

/**
 * Side quest: sending one proposal into another chain from a hold. A
 * `side quest: @name chain` line in Conversation names the proposal and the
 * chain to run it through; the result lands under that same line. The main
 * run is untouched — this never edits a proposal or the Direction.
 */

export interface SideQuestTurn {
  name: string
  chainName: string
}

/** The run a side quest landed on, and what it answered. */
export interface SideQuestRun {
  runId: string
  url?: string
  result: string
}

/** A side quest as the Conversation reads back; no run until one has landed. */
export interface SideQuestEntry extends SideQuestTurn {
  runId?: string
  result?: string
}

const QUEST_LINE = /^side quest:\s*@(\S+)\s+(.+?)$/i
const RUN_LINE = /^→ (?:\[run (\S+)\]\(.*\)|run (\S+))$/

function locatedQuests(content: string): LocatedTrigger<SideQuestTurn>[] {
  return locatedTriggers(content, QUEST_LINE, match => ({ name: match[1], chainName: match[2] }))
}

function resultBlock(run: SideQuestRun): string {
  const link = run.url ? `[run ${run.runId}](${run.url})` : `run ${run.runId}`
  return quoted(`→ ${link}\n${run.result.trim()}`)
}

/** The run's result, linked and quoted, under the trigger line. Unchanged if that trigger is gone. */
export function appendSideQuestResult(content: string, quest: SideQuestTurn, run: SideQuestRun): string {
  const found = locatedQuests(content).find(
    candidate => candidate.fields.name === quest.name && candidate.fields.chainName === quest.chainName && candidate.reply === undefined,
  )
  if (!found) return content
  return content.slice(0, found.insertAt) + resultBlock(run) + '\n' + content.slice(found.insertAt)
}

/** A `side quest:` line, as the Conversation's last entry, for the result to land under. */
export function appendSideQuestTrigger(content: string, quest: SideQuestTurn): string {
  return appendToConversation(content, `side quest: @${quest.name} ${quest.chainName}`)
}

/** Every side quest under Conversation, in order, each with where it sits in the note. */
export function sideQuestEntries(content: string): { entry: SideQuestEntry; at: number }[] {
  return locatedQuests(content).map(({ fields, insertAt, reply }) => {
    const [first = '', ...rest] = reply?.split('\n') ?? []
    const ran = RUN_LINE.exec(first.trim())
    const runId = ran?.[1] ?? ran?.[2]
    return { entry: { ...fields, ...(runId ? { runId, result: rest.join('\n').trim() } : {}) }, at: insertAt }
  })
}
