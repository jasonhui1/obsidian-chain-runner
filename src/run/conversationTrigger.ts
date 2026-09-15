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
  return match ? Math.min(lineEnd(content, match.index) + 1, content.length) : content.length
}

/** Where the line starting at `at` ends, not including its newline. */
export function lineEnd(content: string, at: number): number {
  const newline = content.indexOf('\n', at)
  return newline === -1 ? content.length : newline
}

/**
 * `block` as the Conversation's last entry, a blank line after whatever came
 * before it and ahead of any heading that follows; the heading is added when missing.
 */
export function appendToConversation(content: string, block: string): string {
  const match = CONVERSATION_HEADING.exec(content)
  if (!match) return `${content.trimEnd()}\n\n## Conversation\n\n${block}\n`
  const start = conversationStart(content)
  const heading = /^#{1,6}[ \t]+.*$/gm
  heading.lastIndex = start
  const end = heading.exec(content)?.index ?? content.length
  const body = content.slice(start, end).trimEnd()
  const rest = content.slice(end)
  return `${content.slice(0, start)}${body === '' ? '\n' : `${body}\n\n`}${block}\n${rest === '' ? '' : `\n${rest}`}`
}

/** Text as blockquote lines, one `> ` per line, blank lines kept. */
export function quoted(text: string): string {
  return text
    .trim()
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')
}

export interface LocatedTrigger<T> {
  fields: T
  /** Offset right after the trigger line — where a fresh reply is inserted. */
  insertAt: number
  /** Offset right after the trigger line and its reply. */
  end: number
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
    found.push({ fields: fields(match), insertAt, end: offset, reply: replyLines.length > 0 ? replyLines.join('\n') : undefined })
  }
  return found
}
