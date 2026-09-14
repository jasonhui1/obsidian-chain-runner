import { fileName } from './outputNote'
import { extractSection } from './section'
import type { LayoutPanel } from '../engine/types'

/**
 * The hold-note convention: what a finished run's layout becomes on disk, for a
 * human to direct. Every hold lives under one fixed folder, keyed by run id
 * alone — there is one hold per run.
 */

const HOLD_FOLDER = 'Maestro/holds'

const DIRECTIONS = ['KEEP', 'CHANGE', 'KILL', 'PUSH', 'REDUCE', 'MUTATE', 'COMBINE']

export interface HoldNoteInput {
  runId: string
  chainName: string
  /** The run's panels, as the layout endpoint projects them. */
  panels: LayoutPanel[]
  /** A proposer's stored thinking, keyed by the panel's node id. */
  thoughts: Record<string, string>
}

export function holdNotePath(runId: string): string {
  return `${HOLD_FOLDER}/${fileName(runId)}.md`
}

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
      ...(verdict ? [`## Verdict (${input.chainName})`, '', verdict.text.trim(), ''] : []),
      '## Proposals',
      ...proposers.flatMap(panel => proposalSection(panel, input.thoughts[panel.node])),
      '## Direction',
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
 * in place — so directing a run twice never clobbers what the human wrote.
 */
export function mergeHoldNote(fresh: string, previous: string | undefined): string {
  const kept = previous === undefined ? undefined : directionOnward(previous)
  if (kept === undefined) return fresh
  const match = DIRECTION_HEADING.exec(fresh)
  return match ? fresh.slice(0, match.index) + kept : fresh
}

/**
 * The Direction section's own body — KEEP/CHANGE/… lines, free text and any
 * CANON? ticks — up to the next heading. `undefined` when the note has no
 * Direction heading at all, which is what tells Resume this is not a hold note.
 */
export function directionBlock(content: string): string | undefined {
  return DIRECTION_HEADING.test(content) ? extractSection(content, 'Direction') : undefined
}

const RESUMED_HEADING = /^##\s+Resumed\s*$/m

/** A link to the run a resume produced, appended under its own heading. */
export function appendResumeLink(content: string, run: { runId: string; url?: string }): string {
  const line = run.url ? `- [develop-direction run ${run.runId}](${run.url})` : `- develop-direction run ${run.runId}`
  const trimmed = content.replace(/\s+$/, '')
  return RESUMED_HEADING.test(trimmed) ? `${trimmed}\n${line}\n` : `${trimmed}\n\n## Resumed\n${line}\n`
}
