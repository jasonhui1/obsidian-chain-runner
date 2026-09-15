import { locatedTriggers } from './conversationTrigger'

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

const QUEST_LINE = /^side quest:\s*@(\S+)\s+(\S+)\s*$/i

function fields(match: RegExpExecArray): SideQuestTurn {
  return { name: match[1], chainName: match[2] }
}

/** The most recent `side quest: @name chain` line with no result under it yet. */
export function pendingSideQuest(content: string): SideQuestTurn | undefined {
  const quests = locatedTriggers(content, QUEST_LINE, fields)
  const last = quests[quests.length - 1]
  return last && last.reply === undefined ? last.fields : undefined
}

/** The run's result, linked and quoted, under the trigger line. Unchanged if that trigger is gone. */
export function appendSideQuestResult(content: string, quest: SideQuestTurn, run: { runId: string; url?: string }, result: string): string {
  const found = locatedTriggers(content, QUEST_LINE, fields).find(
    candidate => candidate.fields.name === quest.name && candidate.fields.chainName === quest.chainName && candidate.reply === undefined,
  )
  if (!found) return content
  const link = run.url ? `[run ${run.runId}](${run.url})` : `run ${run.runId}`
  const block = [`→ ${link}`, ...result.trim().split('\n')].map(line => `> ${line}`).join('\n')
  return content.slice(0, found.insertAt) + block + '\n' + content.slice(found.insertAt)
}
