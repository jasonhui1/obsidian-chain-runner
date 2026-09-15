/**
 * Canon: the vault note a hold's CANON? ticks land in. Humans write it; a
 * resume adds each ticked line under the section its own tag names —
 * LOCKED, UNRESOLVED, or REJECTED — defaulting an untagged line to LOCKED.
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

type CanonSection = 'LOCKED' | 'UNRESOLVED' | 'REJECTED'

const CANON_SECTIONS: readonly CanonSection[] = ['LOCKED', 'UNRESOLVED', 'REJECTED']

const TAGGED_LINE = new RegExp(`^(${CANON_SECTIONS.join('|')}):\\s*(.+)$`)

/** A ticked line's own tag decides its section; an untagged line defaults to LOCKED. */
function sectionOf(line: string): { section: CanonSection; text: string } {
  const match = TAGGED_LINE.exec(line)
  return match ? { section: match[1] as CanonSection, text: match[2] } : { section: 'LOCKED', text: line }
}

// `[ \t]`, not `\s`: `\s` reaches across the heading's own newline, pulling it
// into the match and throwing bodyStart a line too far.
function sectionHeading(section: CanonSection): RegExp {
  return new RegExp(`^##[ \\t]+${section}[ \\t]*$`, 'm')
}

/** Where a section's body ends: the next heading, or the end of the file. */
function nextHeadingIndex(text: string, from: number): number {
  const heading = /^#{1,6}[ \t]+.*$/gm
  heading.lastIndex = from
  const match = heading.exec(text)
  return match ? match.index : text.length
}

const BULLET_LINE = /^-\s*(.+)$/

/** The trimmed text of each bullet directly under a heading's body. */
function bulletTexts(body: string): string[] {
  return body
    .split('\n')
    .map(line => BULLET_LINE.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(match => match[1].trim())
}

/**
 * `lines` appended each under the section its own tag names, after whatever is
 * already there — tag stripped, and defaulting to LOCKED when a line carries
 * none. A file missing a targeted section's heading gets one, so nothing
 * ticked is ever lost; nothing ticked at all leaves the file exactly as it
 * was. A line already sitting under its section — human-written or from an
 * earlier resume — is skipped rather than duplicated.
 */
export function appendCanon(existing: string | undefined, lines: string[]): string {
  const base = existing ?? freshCanon()
  const bySection = new Map<CanonSection, string[]>()
  for (const line of lines) {
    const { section, text } = sectionOf(line)
    bySection.set(section, [...(bySection.get(section) ?? []), text])
  }

  return CANON_SECTIONS.reduce((acc, section) => {
    const sectionLines = bySection.get(section)
    return sectionLines ? appendUnderSection(acc, section, sectionLines) : acc
  }, base)
}

function appendUnderSection(base: string, section: CanonSection, lines: string[]): string {
  const heading = sectionHeading(section).exec(base)
  const bodyStart = heading ? heading.index + heading[0].length : -1
  const bodyEnd = heading ? nextHeadingIndex(base, bodyStart + 1) : -1
  const body = heading ? base.slice(bodyStart, bodyEnd).trim() : ''

  const existingBulletTexts = new Set(bulletTexts(body))
  const newLines = lines.filter(line => !existingBulletTexts.has(line.trim()))
  if (newLines.length === 0) return base

  const bullets = newLines.map(line => `- ${line}`).join('\n')
  if (!heading) return `${base.replace(/\s+$/, '')}\n\n## ${section}\n${bullets}\n`

  const newBody = `${body === '' ? '' : `${body}\n`}${bullets}`
  return `${base.slice(0, bodyStart)}\n${newBody}\n\n${base.slice(bodyEnd).replace(/^\s+/, '')}`
}
