/**
 * The text a note contributes to a run. Frontmatter is the vault's bookkeeping,
 * not the chain's argument, so it comes off — but only a block the note *opens*
 * with; a `---` further down is prose.
 */
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/

export function seedFromNote(text: string): string {
  return text.replace(FRONTMATTER, '').trim()
}

/** Where a run's seed came from — the whole note, the passage in front of you, or the lines kept off one. */
export type SeedOrigin = 'selection' | 'note' | 'marks'

/** The note a run was launched from: how the header names it, and what its links resolve against. */
export interface SeedSource {
  name: string
  path: string
}

/** The text a run was given, and what it came from; `RunSeed` is the header's half. */
export interface Seed {
  text: string
  from: SeedOrigin
}

/**
 * What to run a chain on: the selection when there is one, the note otherwise. A
 * selection is left as made — frontmatter inside one was highlighted on purpose.
 */
export function chooseSeed(input: { selection?: string; noteText: string }): Seed {
  const selection = (input.selection ?? '').trim()
  if (selection !== '') return { text: selection, from: 'selection' }
  return { text: seedFromNote(input.noteText), from: 'note' }
}

/**
 * One seed from several inputs, in reading order. A blank line between them and
 * nothing else: a heading invented here would read as the reader's words.
 */
export function joinSeed(parts: readonly string[]): string {
  return parts
    .map(part => part.trim())
    .filter(part => part !== '')
    .join(SEPARATOR)
}

/** A blank line, which is a paragraph break in every chain's reading of it. */
const SEPARATOR = '\n\n'
