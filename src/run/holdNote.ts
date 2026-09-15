import { readConversation, type ConversationEntry } from './conversation'
import { fileName } from './outputNote'
import { extractSection } from './section'
import type { AgentOutput, LayoutPanel } from '../engine/types'

/**
 * The hold-note convention: what a finished run's layout becomes on disk, for a
 * human to direct. Every hold lives under one fixed folder, keyed by run id
 * alone — there is one hold per run, renamed to the newest run a rerun lands on.
 */

const HOLD_FOLDER = 'Maestro/holds'

const DIRECTIONS = ['KEEP', 'CHANGE', 'KILL', 'PUSH', 'REDUCE', 'MUTATE', 'COMBINE'] as const
type Direction = (typeof DIRECTIONS)[number]

/** The verbs a proposal carries a button for; CHANGE stays free text only — it describes a change rather than naming a proposal whole. */
export const DIRECTION_VERBS: readonly Exclude<Direction, 'CHANGE'>[] = DIRECTIONS.filter(
  (direction): direction is Exclude<Direction, 'CHANGE'> => direction !== 'CHANGE',
)
export type DirectionVerb = (typeof DIRECTION_VERBS)[number]

export interface HoldNoteInput {
  runId: string
  chainName: string
  /** The run's panels, as the layout endpoint projects them. */
  panels: LayoutPanel[]
  /** A proposer's stored thinking, keyed by the panel's node id. */
  thoughts: Record<string, string>
  /** Verdicts of the runs this hold was rerun from, already folded, newest first. */
  previousVerdicts?: string
}

export function holdNotePath(runId: string): string {
  return `${HOLD_FOLDER}/${fileName(runId)}.md`
}

/** Each node's stored thought; last write wins, matching how the engine resolves a node's outputs. */
export function thoughtsByNode(outputs: AgentOutput[]): Record<string, string> {
  const thoughts: Record<string, string> = {}
  for (const output of outputs) {
    if (output.nodeId && output.thought) thoughts[output.nodeId] = output.thought
  }
  return thoughts
}

const HOLD_HEADING = /^# Hold: run (\S+) · (.+?)\s*$/m

/** The run and chain a hold note was written for, from its title; `undefined` for any other note. */
export function holdHeading(content: string): { runId: string; chainName: string } | undefined {
  const match = HOLD_HEADING.exec(content)
  return match ? { runId: match[1], chainName: match[2] } : undefined
}

const verdictHeading = (chainName: string) => `## Verdict (${chainName})`
const PREVIOUS_VERDICT = '## Previous verdict'
const PROPOSALS = '## Proposals'
const DIRECTION = '## Direction'

/**
 * A fresh hold note for a finished run: the join panel as the verdict (a
 * `columns` chain's converging panel; absent under any other layout), every
 * other panel as a proposal with its thought folded read-only, a Direction
 * template, and an empty Conversation.
 */
export function holdNoteContent(input: HoldNoteInput): string {
  const verdict = input.panels.find(panel => panel.emphasis === 'join')
  const proposers = input.panels.filter(panel => panel.emphasis !== 'join')

  return (
    [
      `# Hold: run ${input.runId} · ${input.chainName}`,
      '',
      'Stopped because: chain ended at its declared outputs.',
      '',
      ...(verdict ? [verdictHeading(input.chainName), '', verdict.text.trim(), ''] : []),
      ...(input.previousVerdicts ? [PREVIOUS_VERDICT, '', input.previousVerdicts, ''] : []),
      PROPOSALS,
      ...proposers.flatMap(panel => proposalSection(panel, input.thoughts[panel.node])),
      DIRECTION,
      ...DIRECTIONS.map(direction => `${direction}:`),
      '',
      ...canonSection(proposers),
      '## Conversation',
      '',
    ].join('\n') + '\n'
  )
}

function proposalSection(panel: LayoutPanel, thought: string | undefined): string[] {
  return [`### ${panel.name}`, '', ...(thought ? thinkingFold(thought) : []), panel.text.trim(), '']
}

function thinkingFold(thought: string): string[] {
  return ['<details>', '<summary>thinking</summary>', '', thought.trim(), '', '</details>', '']
}

/** CANON? checkboxes, one per line each proposer offered under `## Proposed canon`. */
function canonSection(proposers: LayoutPanel[]): string[] {
  const lines = proposers.flatMap(panel =>
    canonLines(panel.text).map(line => `- [ ] ${line} — ${panel.name}`),
  )
  return lines.length === 0 ? [] : ['CANON?', ...lines, '']
}

/** A proposer's `## Proposed canon` lines, minus the bullet marker its own list wrote them with. */
function canonLines(text: string): string[] {
  return extractSection(text, 'Proposed canon')
    .split('\n')
    .map(line => line.trim().replace(/^[-*+]\s+/, ''))
    .filter(line => line !== '')
}

const DIRECTION_HEADING = /^##\s+Direction\s*$/m

/**
 * A previously-written note's Direction section onward, verbatim — the human's
 * ticks and words, and whatever followed it (Conversation included). `undefined`
 * when the note holds no such heading, which a hold note this module wrote
 * always does.
 */
function directionOnward(content: string): string | undefined {
  const match = DIRECTION_HEADING.exec(content)
  return match ? content.slice(match.index) : undefined
}

/**
 * A fresh note, with a previous write's Direction and everything after it kept
 * in place — so directing a run twice never clobbers what the human wrote,
 * except the CANON? checklist, which is rebuilt from the fresh note's proposals.
 */
export function mergeHoldNote(fresh: string, previous: string | undefined): string {
  const kept = previous === undefined ? undefined : directionOnward(previous)
  if (kept === undefined) return fresh
  const match = DIRECTION_HEADING.exec(fresh)
  return match ? fresh.slice(0, match.index) + mergedDirection(fresh, kept) : fresh
}

interface CanonEntry {
  ticked: boolean
  /** The checklist line minus its `- [ ]`/`- [x]` marker — proposal text and attribution together. */
  text: string
}

const CANON_LINE = /^-\s*\[([ xX])\]\s*(.+)$/

/** The CANON? checklist in `content`, if it has one — its entries, and where the heading through its last line sits. */
function canonBlock(content: string, from = 0): { entries: CanonEntry[]; start: number; end: number } | undefined {
  const start = lineAt(content, 'CANON?', from)
  if (start === -1) return undefined

  const entries: CanonEntry[] = []
  let at = afterLine(content, start)
  let end = at
  for (;;) {
    const stop = lineEndAt(content, at)
    const match = CANON_LINE.exec(content.slice(at, stop).trim())
    if (!match) break
    entries.push({ ticked: match[1].toLowerCase() === 'x', text: match[2] })
    end = stop + 1
    if (stop === content.length) break
    at = stop + 1
  }
  return { entries, start, end }
}

/** Where the line starting at `at` ends, not including its newline. */
function lineEndAt(content: string, at: number): number {
  const newline = content.indexOf('\n', at)
  return newline === -1 ? content.length : newline
}

/**
 * `fresh`'s lines, ticked where `previous` had them ticked, plus any of
 * `previous`'s ticked lines no longer offered.
 */
function mergeCanonEntries(fresh: CanonEntry[], previous: CanonEntry[]): CanonEntry[] {
  const previousByText = new Map(previous.map(entry => [entry.text, entry]))
  const merged = fresh.map(entry => ({ text: entry.text, ticked: previousByText.get(entry.text)?.ticked ?? false }))
  const mergedTexts = new Set(merged.map(entry => entry.text))
  const orphanedTicks = previous.filter(entry => entry.ticked && !mergedTexts.has(entry.text))
  return [...merged, ...orphanedTicks]
}

function canonBlockText(entries: CanonEntry[]): string {
  return ['CANON?', ...entries.map(entry => `- [${entry.ticked ? 'x' : ' '}] ${entry.text}`), ''].join('\n')
}

/** `kept`'s Direction, its CANON? checklist rebuilt from `fresh`'s proposals; everything else left as the human wrote it. */
function mergedDirection(fresh: string, kept: string): string {
  const freshEntries = canonBlock(fresh)?.entries ?? []
  const previousBlock = canonBlock(kept)
  const merged = mergeCanonEntries(freshEntries, previousBlock?.entries ?? [])

  if (previousBlock) return replaceCanonBlock(kept, previousBlock, merged)
  return merged.length === 0 ? kept : appendCanonBlock(kept, merged)
}

function replaceCanonBlock(kept: string, block: { start: number; end: number }, entries: CanonEntry[]): string {
  if (entries.length === 0) return kept.slice(0, block.start) + kept.slice(afterOptionalBlankLine(kept, block.end))
  return kept.slice(0, block.start) + canonBlockText(entries) + kept.slice(block.end)
}

/** `at`, skipped past one blank line if the line starting there is empty. */
function afterOptionalBlankLine(content: string, at: number): number {
  return content.slice(at, lineEndAt(content, at)) === '' ? afterLine(content, at) : at
}

/** A CANON? checklist appended at the end of `kept`'s Direction body, ahead of whatever heading follows it — for a note that had none yet. */
function appendCanonBlock(kept: string, entries: CanonEntry[]): string {
  const bodyStart = afterLine(kept, 0)
  const heading = /^#{1,6}[ \t]+.*$/gm
  heading.lastIndex = bodyStart
  const next = heading.exec(kept)
  const bodyEnd = next ? next.index : kept.length

  const body = kept.slice(bodyStart, bodyEnd).replace(/\s+$/, '')
  const block = canonBlockText(entries).replace(/\n$/, '')
  const newBody = `${body === '' ? '' : `${body}\n\n`}${block}\n`
  return `${kept.slice(0, bodyStart)}${newBody}\n${kept.slice(bodyEnd).replace(/^\s+/, '')}`
}

/**
 * The Direction section's own body — KEEP/CHANGE/… lines, free text and any
 * CANON? ticks — up to the next heading. `undefined` when the note has no
 * Direction heading at all, which is what tells Resume this is not a hold note.
 */
export function directionBlock(content: string): string | undefined {
  return DIRECTION_HEADING.test(content) ? extractSection(content, 'Direction') : undefined
}

/**
 * Each proposal whose text, thinking fold aside, no longer matches its panel, keyed by node.
 * A proposal may hold headings of its own, so it ends only at the next proposer or Direction.
 */
export function proposalEdits(content: string, panels: LayoutPanel[]): Record<string, string> {
  const proposalsAt = lineAt(content, PROPOSALS, 0)
  if (proposalsAt === -1) return {}
  const proposers = panels.filter(panel => panel.emphasis !== 'join')
  const ends = [...proposers.map(panel => `### ${panel.name}`), DIRECTION]

  const edits: Record<string, string> = {}
  for (const panel of proposers) {
    const body = bodyUnder(content, `### ${panel.name}`, ends, proposalsAt)
    if (body === undefined) continue
    const text = body.replace(THINKING_FOLD, '').trim()
    if (text !== panel.text.trim()) edits[panel.node] = text
  }
  return edits
}

const THINKING_FOLD = /^\s*<details>\s*<summary>thinking<\/summary>[\s\S]*?<\/details>/

/** The note for the run a rerun landed on, the verdict it replaces folded atop earlier ones, Direction onward kept. */
export function refreshHoldNote(previous: string, input: HoldNoteInput): string {
  const heading = holdHeading(previous)
  const oldVerdict = heading ? bodyUnder(previous, verdictHeading(heading.chainName), [PREVIOUS_VERDICT, PROPOSALS], 0)?.trim() : undefined
  const earlier = bodyUnder(previous, PREVIOUS_VERDICT, [PROPOSALS], 0)?.trim()
  const folds = [heading && oldVerdict ? verdictFold(heading.runId, oldVerdict) : '', earlier ?? '']
    .filter(fold => fold !== '')
    .join('\n\n')
  return mergeHoldNote(holdNoteContent({ ...input, ...(folds ? { previousVerdicts: folds } : {}) }), previous)
}

function verdictFold(runId: string, verdict: string): string {
  return ['<details>', `<summary>run ${runId}</summary>`, '', verdict, '', '</details>'].join('\n')
}

/** Where a line reading exactly `line` starts, searching line starts from `from`; -1 when none does. */
function lineAt(content: string, line: string, from: number): number {
  for (let at = from; at < content.length; ) {
    const end = content.indexOf('\n', at)
    const stop = end === -1 ? content.length : end
    if (content.slice(at, stop).trimEnd() === line) return at
    at = stop + 1
  }
  return -1
}

/** Where the line starting at `at` ends — the start of whatever follows it. */
function afterLine(content: string, at: number): number {
  const newline = content.indexOf('\n', at)
  return newline === -1 ? content.length : newline + 1
}

/** The text under the `heading` line, up to the first of `ends` after it; `undefined` without the heading. */
function bodyUnder(content: string, heading: string, ends: string[], from: number): string | undefined {
  const start = lineAt(content, heading, from)
  if (start === -1) return undefined
  const bodyStart = afterLine(content, start)
  const endAt = Math.min(content.length, ...ends.map(end => lineAt(content, end, bodyStart)).filter(at => at !== -1))
  return content.slice(bodyStart, endAt)
}

/** A verb button's line: the verb naming the proposal it was pressed on; COMBINE names a second. */
export function directionLine(verb: DirectionVerb, name: string, secondName?: string): string {
  return `${verb}: ${name}${secondName ? ` + ${secondName}` : ''}`
}

/**
 * `line` appended at the end of the Direction block, after whatever the human
 * already put there — free text and CANON? ticks included. Unchanged without a
 * Direction heading, which is what tells a button this is not a hold note.
 */
export function appendDirectionLine(content: string, line: string): string {
  const match = DIRECTION_HEADING.exec(content)
  if (!match) return content
  const bodyStart = afterLine(content, match.index)

  const heading = /^#{1,6}[ \t]+.*$/gm
  heading.lastIndex = bodyStart
  const next = heading.exec(content)
  const bodyEnd = next ? next.index : content.length

  const body = content.slice(bodyStart, bodyEnd).replace(/\s+$/, '')
  const newBody = `${body === '' ? '' : `${body}\n`}${line}\n`
  return `${content.slice(0, bodyStart)}${newBody}\n${content.slice(bodyEnd).replace(/^\s+/, '')}`
}

/** A hold as the directing panel reads it: plain data, no note sections. */
export interface HoldReading {
  runId: string
  chainName: string
  /** The join panel's text; absent when the run did not converge. */
  verdict?: string
  proposals: HoldProposal[]
  /** The Direction's lines so far, minus the empty verb template and the canon checklist. */
  direction: string[]
  canon: CanonChoice[]
  conversation: ConversationEntry[]
}

export interface HoldProposal {
  name: string
  /** The proposal's words, its thinking fold left out. */
  text: string
  /** The verbs a Direction line already gives it. */
  given: DirectionVerb[]
  /** The proposals a COMBINE line already joins it with. */
  combinedWith: string[]
}

export interface CanonChoice {
  /** What `tickCanonLine` finds the line by. */
  id: string
  /** The line's words, without who offered it. */
  text: string
  proposer: string
  ticked: boolean
}

/** A hold note read whole; `undefined` for a note that is not one. */
export function readHold(content: string): HoldReading | undefined {
  const heading = holdHeading(content)
  const direction = directionBlock(content)
  if (!heading || direction === undefined) return undefined
  const lines = directionLines(direction)
  const verdict = bodyUnder(content, verdictHeading(heading.chainName), [PREVIOUS_VERDICT, PROPOSALS], 0)?.trim()
  return {
    ...heading,
    ...(verdict ? { verdict } : {}),
    proposals: proposalsIn(content).map(proposal => ({
      ...proposal,
      given: verbsGiven(lines, proposal.name),
      combinedWith: combinedWith(lines, proposal.name),
    })),
    direction: lines,
    canon: (canonBlock(direction)?.entries ?? []).map(canonChoice),
    conversation: readConversation(content),
  }
}

/**
 * Each `### ` proposal under Proposals, up to the next one or Direction. A
 * proposer writes its own sections as `## `, so those stay inside it.
 */
function proposalsIn(content: string): { name: string; text: string }[] {
  const proposalsAt = lineAt(content, PROPOSALS, 0)
  if (proposalsAt === -1) return []
  const directionAt = lineAt(content, DIRECTION, proposalsAt)
  const body = content.slice(afterLine(content, proposalsAt), directionAt === -1 ? content.length : directionAt)
  return body
    .split(/^### /m)
    .slice(1)
    .map(chunk => {
      const newline = afterLine(chunk, 0)
      return { name: chunk.slice(0, newline).trim(), text: chunk.slice(newline).replace(THINKING_FOLD, '').trim() }
    })
}

const EMPTY_VERB = new RegExp(`^(${DIRECTIONS.join('|')}):$`)

function directionLines(direction: string): string[] {
  return direction
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && line !== 'CANON?' && !EMPTY_VERB.test(line) && !CANON_LINE.test(line))
}

const GIVEN_LINE = new RegExp(`^(${DIRECTION_VERBS.join('|')}):\\s*(.+)$`)

/** Each verb line naming `name`, as its verb and every proposal it names. */
function linesNaming(lines: string[], name: string): { verb: DirectionVerb; named: string[] }[] {
  return lines
    .map(line => GIVEN_LINE.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(match => ({ verb: match[1] as DirectionVerb, named: match[2].split(' + ').map(named => named.trim()) }))
    .filter(line => line.named.includes(name))
}

function verbsGiven(lines: string[], name: string): DirectionVerb[] {
  return [...new Set(linesNaming(lines, name).map(line => line.verb))]
}

function combinedWith(lines: string[], name: string): string[] {
  const others = linesNaming(lines, name)
    .filter(line => line.verb === 'COMBINE')
    .flatMap(line => line.named.filter(named => named !== name))
  return [...new Set(others)]
}

function canonChoice(entry: CanonEntry): CanonChoice {
  const at = entry.text.lastIndexOf(' — ')
  return {
    id: entry.text,
    text: at === -1 ? entry.text : entry.text.slice(0, at),
    proposer: at === -1 ? '' : entry.text.slice(at + 3),
    ticked: entry.ticked,
  }
}

/** The canon line `id` ticked or unticked in place; unchanged when the note no longer offers it. */
export function tickCanonLine(content: string, id: string, ticked: boolean): string {
  const directionAt = DIRECTION_HEADING.exec(content)?.index
  const block = directionAt === undefined ? undefined : canonBlock(content, directionAt)
  if (!block) return content
  const lines = content
    .slice(block.start, block.end)
    .split('\n')
    .map(line => (CANON_LINE.exec(line.trim())?.[2] === id ? `- [${ticked ? 'x' : ' '}] ${id}` : line))
  return content.slice(0, block.start) + lines.join('\n') + content.slice(block.end)
}

/** The Direction with every line reading exactly one of `lines` taken out; the rest left as written. */
export function removeDirectionLines(content: string, lines: string[]): string {
  const match = DIRECTION_HEADING.exec(content)
  if (!match) return content
  const bodyStart = afterLine(content, match.index)
  const heading = /^#{1,6}[ \t]+.*$/gm
  heading.lastIndex = bodyStart
  const bodyEnd = heading.exec(content)?.index ?? content.length
  const body = content
    .slice(bodyStart, bodyEnd)
    .split('\n')
    .filter(line => !lines.includes(line.trim()))
    .join('\n')
  return content.slice(0, bodyStart) + body + content.slice(bodyEnd)
}

const RESUMED_HEADING = /^##\s+Resumed\s*$/m

/** A link to the run a resume produced, appended under its own heading. */
export function appendResumeLink(content: string, run: { runId: string; url?: string }): string {
  const line = run.url ? `- [develop-direction run ${run.runId}](${run.url})` : `- develop-direction run ${run.runId}`
  const trimmed = content.replace(/\s+$/, '')
  return RESUMED_HEADING.test(trimmed) ? `${trimmed}\n${line}\n` : `${trimmed}\n\n## Resumed\n${line}\n`
}
