import { runViewUrl } from './provenance'
import type { RunPanel } from './panels'

/**
 * The output-note convention: what a kept panel becomes on disk. Every surface
 * that keeps a piece of a run writes it this way, so a note in the vault says
 * which run, chain and output it came from.
 */

/** What a run knows about itself when one of its panels is kept. */
export interface OutputNoteMeta {
  /** The engine's id for the run. It is the run folder's name and the `run` key. */
  runId: string
  chainName: string
  /** Where output notes go, from settings; the run folder is created inside it. */
  folder: string
  /** The engine the run happened on, which the note's `source` link points into. */
  engineUrl: string
}

/**
 * Characters a filename cannot hold, plus the four markdown reads specially.
 * Each becomes a dash, so names differing only there stay two names.
 */
const UNUSABLE = /[\\/:*?"<>|#^[\]]/g

/**
 * The output's name as a filename — the chain's own word, case and spaces and
 * all, with only what a filename cannot hold replaced.
 */
function fileName(name: string): string {
  // A name of nothing but those characters — `///`, `...` — would file as
  // `---.md` or as a hidden note called `.md`, so it gets a word instead.
  if (name.replace(UNUSABLE, '').replace(/[\s.]/g, '') === '') return 'output'
  // Leading and trailing dots and spaces are legal in a path and confusing in a list.
  return name.replace(UNUSABLE, '-').replace(/^[\s.]+|[\s.]+$/g, '')
}

/** Where a panel's note goes, before collisions are resolved. */
export function outputNotePath(panel: RunPanel, meta: OutputNoteMeta): string {
  const folder = meta.folder.replace(/^\/+|\/+$/g, '')
  const run = fileName(meta.runId)
  return `${folder}/${run}/${fileName(panel.name)}.md`
}

/** A frontmatter value. Everything is quoted, so a chain named `yes` stays a string. */
function yaml(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * The note itself: the keys the convention promises, then the hop's text
 * untouched — a hop's own frontmatter or heading is kept, below this one. The
 * `source` link is for a reader outside the plugin; the header resolves its own
 * against the engine set now (ADR-0004).
 */
export function outputNoteContent(panel: RunPanel, meta: OutputNoteMeta): string {
  const source = runViewUrl(meta.engineUrl, meta.runId)
  const frontmatter = [
    '---',
    `run: ${yaml(meta.runId)}`,
    `chain: ${yaml(meta.chainName)}`,
    `output: ${yaml(panel.name)}`,
    ...(source ? [`source: ${yaml(source)}`] : []),
    '---',
    '',
  ]
  return `${frontmatter.join('\n')}\n${body(panel)}\n`
}

/**
 * The hop's words, or why there are none — a run that dies early still leaves a
 * note per output (ADR-0003). Quoted, so it never reads as the chain's words.
 */
function body(panel: RunPanel): string {
  const said = panel.text.replace(/\n+$/, '')
  if (said !== '' || panel.state !== 'errored' || !panel.error) return said
  return `> ${panel.error.trim().split('\n').join('\n> ')}`
}

/** How far the suffix walk goes before it gives up rather than spinning. */
const MOST_SUFFIXES = 1000

/**
 * The path to write to, given what the vault holds. A taken name gets ` 2`, ` 3`
 * and so on, but a note that already says exactly this is reused — so saving a
 * panel and then sending it to a drawing leaves one note.
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
 * For a note opened before it has content (ADR-0003). Only a free name will do:
 * two outputs are both empty when opened, so `resolveOutputPath`'s reuse rule
 * would collapse them into one.
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
  // Unreachable in a real vault; here so a misbehaving `read` ends as a notice
  // rather than a loop that never returns.
  throw new Error(`${path} and the ${MOST_SUFFIXES} names after it are all taken`)
}
