import { yaml } from './outputNote'

/**
 * Keep-marks: the lines a reader marked, and the text they add up to. Marks
 * belong to the marking session, never to the note.
 */

/** A run of marked lines, both ends inclusive, as indices into the text's lines. */
export interface MarkRange {
  from: number
  to: number
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/)
}

/** Ranges in reading order, with touching and overlapping ones made one. */
export function mergeRanges(ranges: readonly MarkRange[]): MarkRange[] {
  const ordered = ranges
    .filter(range => range.to >= range.from)
    .map(range => ({ ...range }))
    .sort((a, b) => a.from - b.from)

  const merged: MarkRange[] = []
  for (const range of ordered) {
    const last = merged[merged.length - 1]
    if (last && range.from <= last.to + 1) last.to = Math.max(last.to, range.to)
    else merged.push(range)
  }
  return merged
}

/** Marked line indices as ranges; consecutive lines become one range. */
export function markedRanges(marked: Iterable<number>): MarkRange[] {
  return mergeRanges([...marked].map(line => ({ from: line, to: line })))
}

/**
 * The marked lines as text: each passage as it stands, and a blank line between
 * passages that were not next to each other — a paragraph break in every chain's
 * reading of it.
 */
export function trimToMarks(text: string, ranges: readonly MarkRange[]): string {
  const lines = splitLines(text)
  return mergeRanges(ranges)
    .map(range => passage(lines.slice(Math.max(range.from, 0), range.to + 1)))
    .filter(kept => kept !== '')
    .join('\n\n')
}

/**
 * One passage: blank lines off either end, and every line that is left exactly
 * as it was — a list item or a code line keeps the indent it was written with.
 */
function passage(lines: string[]): string {
  const blank = (line: string): boolean => line.trim() === ''
  let first = 0
  let last = lines.length - 1
  while (first <= last && blank(lines[first] ?? '')) first++
  while (last >= first && blank(lines[last] ?? '')) last--
  return lines.slice(first, last + 1).join('\n')
}

/**
 * One marking session: which lines are marked, and which line the keyboard is
 * on. Held here rather than in the modal so what a click and an arrow key do is
 * checkable without a vault.
 */
export class MarkSelection {
  readonly lines: string[]
  private readonly marked = new Set<number>()
  private line = 0

  constructor(text: string) {
    this.lines = splitLines(text)
  }

  get cursor(): number {
    return this.line
  }

  get count(): number {
    return this.marked.size
  }

  isMarked(index: number): boolean {
    return this.marked.has(index)
  }

  /** Marks or unmarks a line, and leaves the cursor on it — a click is also a move. */
  toggle(index: number): void {
    if (!this.holds(index)) return
    if (!this.marked.delete(index)) this.marked.add(index)
    this.line = index
  }

  toggleCurrent(): void {
    this.toggle(this.line)
  }

  move(delta: number): void {
    this.line = Math.min(Math.max(this.line + delta, 0), Math.max(this.lines.length - 1, 0))
  }

  ranges(): MarkRange[] {
    return markedRanges(this.marked)
  }

  private holds(index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < this.lines.length
  }
}

/**
 * A trimmed note taken from a note rather than from a run: the shape of an
 * output note, with the note it was trimmed from where the run would be.
 */
export function keptNoteContent(text: string, from: { note: string }): string {
  return `---\nkept from: ${yaml(`[[${from.note}]]`)}\n---\n\n${text}\n`
}

/** Where that note goes: beside the note it was trimmed from. */
export function keptNotePath(sourcePath: string, basename: string): string {
  const cut = sourcePath.lastIndexOf('/')
  const folder = cut === -1 ? '' : sourcePath.slice(0, cut)
  const name = `${basename} (kept).md`
  return folder === '' ? name : `${folder}/${name}`
}
