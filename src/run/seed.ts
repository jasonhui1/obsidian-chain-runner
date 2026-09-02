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
