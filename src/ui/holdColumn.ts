import type { HoldRecord } from '../engine/types'
import type { Box } from './nodeScene'
import { FRAME_PADDING, type RunFrame } from '../run/runFrame'

/** The drawing geometry of a waiting hold. Its candidates keep their slots when picked. */
export interface HoldColumn {
  box: Box
  prompt: { text: string; box: Box }
  candidates: { heading: string; text: string; box: Box; continueAt: { x: number; y: number } }[]
  ownWords: OwnWordsCard
  rerollAt?: { x: number; y: number }
}

export const HOLD_COLUMN_WIDTH = 360
export const PICK_CARD_WIDTH = 320
export const PICK_CARD_HEIGHT = 160
export const PICK_GAP = 24
const PANEL_GAP = 24
const PADDING = 16
const GAP = 12
const HEADER_HEIGHT = 48
const OUTPUT_HEIGHT = 160
const FONT_SIZE = 16
const LINE_HEIGHT = 22
const CONTINUE_HEIGHT = 28

/** Excalidraw measures its own font; this estimate deliberately leaves a line of spare room. */
function wrappedLines(text: string, width: number): number {
  const chars = Math.max(1, Math.floor(width / (FONT_SIZE * 0.72)))
  return text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / chars)), 0)
}

/** The first line of candidate text labels its pick row and reports. */
export function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.trim() ?? ''
}

/** What an empty card for the reader's own words shows until they type. */
export const OWN_WORDS_PLACEHOLDER = '✎ Your own'

/** The reader's words on their card, without the placeholder they may have typed after. */
export function typedWords(text: string): string {
  const words = text.trim()
  return (words.startsWith(OWN_WORDS_PLACEHOLDER) ? words.slice(OWN_WORDS_PLACEHOLDER.length) : words).trim()
}

/** How a pick row names a hold's answer: the candidate's heading, or the first line of the reader's own words. */
export function answeredWith(answer: { chosen?: string; custom?: string }): { heading: string; words?: string } | undefined {
  if (answer.chosen) return { heading: answer.chosen }
  if (answer.custom) return { heading: firstLine(answer.custom) || 'Your own words', words: answer.custom }
  return undefined
}

/** A card for the reader's own words: the box they type in, its `▶ Continue` beneath. */
export interface OwnWordsCard {
  box: Box
  continueAt: { x: number; y: number }
  /** The bottom of the card's slot. */
  bottom: number
}

function ownWordsCard(x: number, y: number, width: number, words = ''): OwnWordsCard {
  const height = Math.max(OUTPUT_HEIGHT - CONTINUE_HEIGHT - PADDING / 2, wrappedLines(words, width - PADDING * 2) * LINE_HEIGHT + PADDING * 2)
  return {
    box: { x, y, width, height },
    continueAt: { x: x + PADDING, y: y + height },
    bottom: y + height + CONTINUE_HEIGHT + PADDING / 2,
  }
}

/** A generic numbered heading gives way to the candidate's first line. */
export function candidateWords(heading: string, body: string): string {
  const first = firstLine(body)
  if (!/^Candidate\s+\d+$/i.test(heading.trim()) || !first) return `${heading}\n${body}`.trim()
  return body.trim()
}

export function buildHoldColumn(hold: HoldRecord, x: number, y: number, options?: { canReroll?: boolean }): HoldColumn {
  const prompt = hold.prompt?.trim() || 'Pick an idea or write your own'
  const promptText = `${hold.nodeId} · ${prompt}`
  const promptWidth = HOLD_COLUMN_WIDTH - PADDING * 2
  const promptBox = {
    x: x + PADDING,
    y: y + PADDING,
    width: promptWidth,
    height: Math.max(HEADER_HEIGHT, wrappedLines(promptText, promptWidth) * LINE_HEIGHT + PADDING),
  }
  let top = promptBox.y + promptBox.height + GAP
  const candidates = hold.candidates.map(candidate => {
    const text = candidateWords(candidate.heading, candidate.body)
    const height = Math.max(OUTPUT_HEIGHT, wrappedLines(text, HOLD_COLUMN_WIDTH - PADDING * 4) * LINE_HEIGHT + PADDING * 2 + CONTINUE_HEIGHT + LINE_HEIGHT)
    const box = { x: x + PADDING, y: top, width: HOLD_COLUMN_WIDTH - PADDING * 2, height }
    top += height + GAP
    return {
      heading: candidate.heading,
      text,
      box,
      continueAt: { x: box.x + PADDING, y: box.y + height - CONTINUE_HEIGHT - PADDING / 2 },
    }
  })
  const ownWords = ownWordsCard(x + PADDING, top, HOLD_COLUMN_WIDTH - PADDING * 2)
  const canReroll = options?.canReroll === true && !hold.resolvedAt && !hold.chosen && !hold.custom
  const rerollAt = canReroll ? { x: x + PADDING, y: ownWords.bottom + GAP } : undefined
  const bottom = rerollAt ? rerollAt.y + CONTINUE_HEIGHT : ownWords.bottom
  return {
    box: { x, y, width: HOLD_COLUMN_WIDTH, height: bottom + PADDING - y },
    prompt: { text: promptText, box: promptBox },
    candidates,
    ownWords,
    ...(rerollAt ? { rerollAt } : {}),
  }
}

/** Already reached panels form one row before the hold, even for a columns layout. */
export function beforeHoldRow(frame: RunFrame, pending: readonly number[]): { index: number; box: Box }[] {
  const excluded = new Set(pending)
  let x = frame.box.x + FRAME_PADDING
  return frame.panels.filter(panel => !excluded.has(panel.index))
    .sort((left, right) => left.index - right.index)
    .map(panel => {
      const box = { ...panel.box, x, y: frame.box.y + FRAME_PADDING }
      x += box.width + PANEL_GAP
      return { index: panel.index, box }
    })
}

/** Every column remains inside the frame when another hold in the wave is added. */
export function waitingFrameBox(frame: Box, panels: readonly Box[], columns: readonly Box[]): Box {
  const all = [...panels, ...columns]
  return {
    ...frame,
    width: Math.max(...all.map(box => box.x + box.width)) + FRAME_PADDING - frame.x,
    height: Math.max(...all.map(box => box.y + box.height)) + FRAME_PADDING - frame.y,
  }
}

const STAMP = 'chainRunnerHold'
export interface HoldStamp {
  runId: string
  nodeId: string
  heading: string
  revision?: number
  outputIndexes?: number[]
  role: 'candidate' | 'continue' | 'column' | 'reroll' | 'custom'
  custom?: boolean
}

export function stampHold(data: HoldStamp): Record<string, unknown> {
  return { [STAMP]: data }
}

export function holdStamp(element: { customData?: unknown }): HoldStamp | undefined {
  const data = element.customData
  if (!data || typeof data !== 'object') return undefined
  const stamp = (data as Record<string, unknown>)[STAMP]
  if (!stamp || typeof stamp !== 'object') return undefined
  const value = stamp as Record<string, unknown>
  if (typeof value.runId !== 'string' || typeof value.nodeId !== 'string' || typeof value.heading !== 'string') return undefined
  if (value.role !== 'candidate' && value.role !== 'continue' && value.role !== 'column' && value.role !== 'reroll' && value.role !== 'custom') return undefined
  if (value.custom !== undefined && typeof value.custom !== 'boolean') return undefined
  return stamp as HoldStamp
}

/** The first pick uses the space reserved beside its candidate. */
export function pickRowBoxes(candidate: Box, count: number): Box[] {
  return Array.from({ length: count }, (_, index) => ({
    x: candidate.x + candidate.width + PICK_GAP + index * (PICK_CARD_WIDTH + PICK_GAP),
    y: candidate.y,
    width: PICK_CARD_WIDTH,
    height: PICK_CARD_HEIGHT,
  }))
}

/** Everything a first pick places, relative to the candidate's reserved slot. */
export function buildPickRow(candidate: Box, count: number): {
  cards: { box: Box; step: { x: number; y: number }; length: { x: number; y: number } }[]
  heading: { x: number; y: number }
  tick: { x: number; y: number }
  direct: { x: number; y: number }
  right: number
} {
  const boxes = pickRowBoxes(candidate, count)
  const right = (boxes.at(-1)?.x ?? candidate.x + candidate.width) + (boxes.at(-1)?.width ?? 0) + 120
  return {
    cards: boxes.map(box => ({
      box,
      step: { x: box.x, y: box.y - 24 },
      length: { x: box.x + box.width - 76, y: box.y + box.height - 22 },
    })),
    heading: { x: boxes[0]?.x ?? candidate.x + candidate.width + PICK_GAP, y: candidate.y - 48 },
    tick: { x: candidate.x + candidate.width - 30, y: candidate.y + 8 },
    direct: { x: right - 105, y: candidate.y + 4 },
    right,
  }
}

/** The height a used own-words card needs to show `words` whole. */
export function ownWordsHeight(box: Box, words: string): number {
  return Math.max(box.height, ownWordsCard(box.x, box.y, box.width, words).box.height)
}

/** The empty card a used own-words card leaves below itself and its pick row; its column now ends at `columnBottom`. */
export function nextOwnWordsCard(used: Box): OwnWordsCard & { columnBottom: number } {
  const y = used.y + Math.max(used.height + CONTINUE_HEIGHT + PADDING / 2, PICK_CARD_HEIGHT) + GAP
  const card = ownWordsCard(used.x, y, used.width)
  return { ...card, columnBottom: card.bottom + PADDING }
}

const PICK_STAMP = 'chainRunnerPick'
/** `from` is the run whose candidate the row sits beside. */
export interface PickStamp { runId: string; nodeId: string; heading: string; from?: string }
/** The panel index a row's step name and line count are for. */
export const PICK_STEP = 'chainRunnerPickStep'
export const PICK_COUNT = 'chainRunnerPickCount'

export function stampPick(data: PickStamp): Record<string, unknown> {
  return { [PICK_STAMP]: data }
}

export function pickStamp(element: { customData?: unknown }): PickStamp | undefined {
  const data = element.customData
  if (!data || typeof data !== 'object') return undefined
  const value = (data as Record<string, unknown>)[PICK_STAMP]
  if (!value || typeof value !== 'object') return undefined
  const stamp = value as Record<string, unknown>
  return typeof stamp.runId === 'string' && typeof stamp.nodeId === 'string' && typeof stamp.heading === 'string'
    && (stamp.from === undefined || typeof stamp.from === 'string')
    ? stamp as unknown as PickStamp : undefined
}
