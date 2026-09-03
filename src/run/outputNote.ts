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
  // A name none of whose characters is kept as itself — `///`, `...`, spaces —
  // would file as `---.md` or, worse, as a hidden note called `.md`. Neither
  // says anything, so it gets a word instead. Both the substitution and the trim
  // below can empty a name, so both are asked here.
  if (name.replace(UNUSABLE, '').replace(/[\s.]/g, '') === '') return 'output'
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
  return `${frontmatter.join('\n')}\n${body(panel)}\n`
}

/**
 * What the note says under its frontmatter: the hop's own words, or — for a hop
 * that failed without producing any — why there are none.
 *
 * A run that dies before its first hop leaves a note per declared output
 * (ADR-0003), and a file holding nothing but frontmatter tells the reader who
 * finds it later nothing at all. The reason is quoted, so it never reads as
 * something the chain said.
 */
function body(panel: RunPanel): string {
  const said = panel.text.replace(/\n+$/, '')
  if (said !== '' || panel.state !== 'errored' || !panel.error) return said
  return `> ${panel.error.trim().split('\n').join('\n> ')}`
}

/** How far the suffix walk goes before it gives up rather than spinning. */
const MOST_SUFFIXES = 1000

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
  return walkNames(path, async candidate => {
    const existing = await read(candidate)
    return existing === undefined || existing === content
  })
}

/**
 * The path to write to when the note is opened before it has anything to say.
 *
 * A run that fills its outputs as it goes (ADR-0003) creates them empty, so the
 * "already says exactly this" rule `resolveOutputPath` uses cannot apply: two
 * outputs of one run are both empty at the moment they are opened, and reusing
 * the first note for the second would collapse them into one that then shows
 * whichever hop wrote last. Here only a free name will do.
 */
export async function freeOutputPath(
  path: string,
  read: (path: string) => Promise<string | undefined>,
): Promise<string> {
  return walkNames(path, async candidate => (await read(candidate)) === undefined)
}

/** ` 2`, ` 3` and so on until `accept` takes one. */
async function walkNames(path: string, accept: (candidate: string) => Promise<boolean>): Promise<string> {
  const stem = path.replace(/\.md$/, '')
  for (let suffix = 1; suffix <= MOST_SUFFIXES; suffix++) {
    const candidate = suffix === 1 ? path : `${stem} ${suffix}.md`
    if (await accept(candidate)) return candidate
  }
  // Unreachable in a vault a person made: it would take a thousand notes of one
  // name. It is here so a `read` that answers wrongly ends as a notice rather
  // than as a loop that never returns.
  throw new Error(`${path} and the ${MOST_SUFFIXES} names after it are all taken`)
}
