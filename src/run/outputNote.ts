import type { RunPanel } from './panels'

/**
 * The output-note convention: what a kept panel becomes on disk.
 *
 * Every surface that keeps a piece of a run writes it this way — the quick
 * path's two actions now, the drawing's embeddables later — so a note found in
 * the vault says which run, which chain and which output it came from whoever
 * wrote it. The whole convention is here, a path and a string, checkable
 * without a vault.
 */

/** What a run knows about itself when one of its panels is kept. */
export interface OutputNoteMeta {
  /** The engine's id for the run. It is the run folder's name and the `run` key. */
  runId: string
  chainName: string
  /** Where output notes go, from settings; the run folder is created inside it. */
  folder: string
}

/**
 * Characters Obsidian will not put in a filename, plus the four markdown links
 * and headings read specially. Each becomes a dash rather than disappearing, so
 * two outputs whose names differ only there stay two names.
 */
const UNUSABLE = /[\\/:*?"<>|#^[\]]/g

/**
 * The output's name, as a filename. The chain's own word for the output is kept
 * — case, spaces and all — because it is what the reader saw on the panel; only
 * what a filename cannot hold is replaced.
 */
function fileName(name: string): string {
  // A name with nothing left after the substitution — `///` — would file as
  // `---.md`, a legal filename that says nothing. It gets a word instead.
  if (name.replace(UNUSABLE, '').trim() === '') return 'output'
  // Leading and trailing dots and spaces are legal in a path and confusing in a
  // file list, so they go the way the unusable characters do.
  return name.replace(UNUSABLE, '-').replace(/^[\s.]+|[\s.]+$/g, '')
}

/** Where a panel's note goes, before collisions are resolved. */
export function outputNotePath(panel: RunPanel, meta: OutputNoteMeta): string {
  const folder = meta.folder.replace(/^\/+|\/+$/g, '')
  const run = fileName(meta.runId)
  return `${folder}/${run}/${fileName(panel.name)}.md`
}

/**
 * A frontmatter value that cannot be misread. Everything is quoted rather than
 * only what has to be: a chain named `yes` or `2026-09-02` is a string here, and
 * a rule with no exceptions is one less thing for a later writer to get wrong.
 */
function yaml(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * The note itself: the three keys the convention promises, then the hop's text
 * exactly as the panel showed it.
 *
 * The text is not touched — a hop that wrote its own frontmatter or its own
 * heading keeps it, below this one. What the hop said is the note's content;
 * where it came from is the note's frontmatter.
 */
export function outputNoteContent(panel: RunPanel, meta: OutputNoteMeta): string {
  const frontmatter = [
    '---',
    `run: ${yaml(meta.runId)}`,
    `chain: ${yaml(meta.chainName)}`,
    `output: ${yaml(panel.name)}`,
    '---',
    '',
  ]
  return `${frontmatter.join('\n')}\n${panel.text.replace(/\n+$/, '')}\n`
}

/**
 * The path to actually write to, given what the vault already holds.
 *
 * `read` answers with a note's content, or `undefined` where there is no note.
 * A name already taken by something else gets ` 2`, ` 3` and so on — but a note
 * that already says exactly this is reused rather than duplicated, so keeping
 * the same panel twice (saved, then sent to a drawing) leaves one note and not
 * two identical ones.
 */
export async function resolveOutputPath(
  path: string,
  content: string,
  read: (path: string) => Promise<string | undefined>,
): Promise<string> {
  const stem = path.replace(/\.md$/, '')
  for (let suffix = 1; ; suffix++) {
    const candidate = suffix === 1 ? path : `${stem} ${suffix}.md`
    const existing = await read(candidate)
    if (existing === undefined || existing === content) return candidate
  }
}
