/**
 * Canon: the vault note a hold's CANON? ticks land in. Humans write it; a
 * resume only ever adds under LOCKED, never touching UNRESOLVED or REJECTED.
 */

export const CANON_PATH = 'context/canon-anime-game.md'

/** The key `POST /api/run`'s `context` map uses — the chain's context node's `file`. */
export const CANON_CONTEXT_KEY = 'canon-anime-game'

const TICKED_LINE = /^-\s*\[[xX]\]\s*(.+)$/

/**
 * A Direction block's ticked CANON? lines, minus their proposer attribution —
 * everything from the *last* ` — `, so a line whose own text has an em dash in
 * it is not cut at the wrong one.
 */
export function tickedCanonLines(direction: string): string[] {
  return direction
    .split('\n')
    .map(line => TICKED_LINE.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(match => withoutAttribution(match[1]))
}

function withoutAttribution(text: string): string {
  const at = text.lastIndexOf(' — ')
  return (at === -1 ? text : text.slice(0, at)).trim()
}

function freshCanon(): string {
  return '## LOCKED\n\n## UNRESOLVED\n\n## REJECTED\n'
}

// `[ \t]`, not `\s`: `\s` reaches across the heading's own newline, pulling it
// into the match and throwing bodyStart a line too far.
const LOCKED_HEADING = /^##[ \t]+LOCKED[ \t]*$/m

/** Where LOCKED's body ends: the next heading, or the end of the file. */
function nextHeadingIndex(text: string, from: number): number {
  const heading = /^#{1,6}[ \t]+.*$/gm
  heading.lastIndex = from
  const match = heading.exec(text)
  return match ? match.index : text.length
}

/**
 * `lines` appended under `## LOCKED`, after whatever is already there. A file
 * with no LOCKED heading gets one, so nothing ticked is ever lost; nothing
 * ticked at all leaves the file exactly as it was.
 */
export function appendLockedCanon(existing: string | undefined, lines: string[]): string {
  if (lines.length === 0) return existing ?? freshCanon()

  const bullets = lines.map(line => `- ${line}`).join('\n')
  const base = existing ?? freshCanon()
  const heading = LOCKED_HEADING.exec(base)
  if (!heading) return `${base.replace(/\s+$/, '')}\n\n## LOCKED\n${bullets}\n`

  const bodyStart = heading.index + heading[0].length
  const bodyEnd = nextHeadingIndex(base, bodyStart + 1)
  const body = base.slice(bodyStart, bodyEnd).trim()
  const newBody = `${body === '' ? '' : `${body}\n`}${bullets}`
  return `${base.slice(0, bodyStart)}\n${newBody}\n\n${base.slice(bodyEnd).replace(/^\s+/, '')}`
}
