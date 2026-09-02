/**
 * The text a note contributes to a run.
 *
 * Frontmatter is the vault's bookkeeping — tags, aliases, dates — and not part
 * of the argument the chain is asked to read, so it comes off before the note
 * body is sent. Only a block the note *opens* with is frontmatter; a `---` rule
 * further down is prose and stays.
 */
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/

export function seedFromNote(text: string): string {
  return text.replace(FRONTMATTER, '').trim()
}

/** Where a run's seed came from — the whole note, or the passage in front of you. */
export type SeedOrigin = 'selection' | 'note'

/**
 * The text a run was given, and what it was taken from. `RunSeed` in
 * `./session` is the header's half of the same fact — the note's name, without
 * the text.
 */
export interface Seed {
  text: string
  from: SeedOrigin
}

/**
 * What to run a chain on: the selection when there is one, the note otherwise.
 *
 * A selection is left as it was made — frontmatter inside one was selected on
 * purpose, and stripping it would run something other than what was highlighted.
 * Only a whole-note seed gets the vault's bookkeeping taken off.
 */
export function chooseSeed(input: { selection?: string; noteText: string }): Seed {
  const selection = (input.selection ?? '').trim()
  if (selection !== '') return { text: selection, from: 'selection' }
  return { text: seedFromNote(input.noteText), from: 'note' }
}
