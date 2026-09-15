/**
 * Shared scanning for a hold note's Conversation section: walking its lines,
 * tracking offsets, and collecting a blockquote reply under a matched trigger
 * line. `chat.ts`, `askRoom.ts` and `sideQuest.ts` each name their own
 * trigger pattern and fields; this is only the walk.
 */

const CONVERSATION_HEADING = /^##\s+Conversation\s*$/m

/** Where the Conversation section's body starts; the note's length when there is no such heading. */
export function conversationStart(content: string): number {
  const match = CONVERSATION_HEADING.exec(content)
  if (!match) return content.length
  const newline = content.indexOf('\n', match.index)
  return newline === -1 ? content.length : newline + 1
}

export interface LocatedTrigger<T> {
  fields: T
  /** Offset right after the trigger line (and its reply, if any) — where a fresh reply is inserted. */
  insertAt: number
  /** The blockquote body directly under the trigger line, `> ` stripped; `undefined` when none follows yet. */
  reply: string | undefined
}

/**
 * Every line under Conversation matching `pattern`, in reading order, each
 * with whatever blockquote reply already follows it. Lines that don't match
 * are skipped over, not collected.
 */
export function locatedTriggers<T>(content: string, pattern: RegExp, fields: (match: RegExpExecArray) => T): LocatedTrigger<T>[] {
  const start = conversationStart(content)
  const lines = content.slice(start).split('\n')
  const found: LocatedTrigger<T>[] = []
  let offset = start

  for (let i = 0; i < lines.length; ) {
    const match = pattern.exec(lines[i].trim())
    if (!match) {
      offset += lines[i].length + 1
      i++
      continue
    }
    offset += lines[i].length + 1
    i++
    const insertAt = offset
    const replyLines: string[] = []
    while (i < lines.length && lines[i].startsWith('> ')) {
      replyLines.push(lines[i].slice(2))
      offset += lines[i].length + 1
      i++
    }
    found.push({ fields: fields(match), insertAt, reply: replyLines.length > 0 ? replyLines.join('\n') : undefined })
  }
  return found
}
