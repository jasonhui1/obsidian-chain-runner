import type { HoldRecord } from '../engine/types'
import type { Box } from './nodeScene'
import { FRAME_PADDING, type RunFrame } from '../run/runFrame'

/** The drawing geometry of a waiting hold. Its candidates keep their slots when picked. */
export interface HoldColumn {
  box: Box
  prompt: { text: string; box: Box }
  candidates: { heading: string; text: string; box: Box; continueAt: { x: number; y: number } }[]
  custom: Box & { continueAt: { x: number; y: number } }
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
  const custom = {
    x: x + PADDING,
    y: top,
    width: HOLD_COLUMN_WIDTH - PADDING * 2,
    height: OUTPUT_HEIGHT,
    continueAt: { x: x + PADDING * 2, y: top + OUTPUT_HEIGHT - CONTINUE_HEIGHT - PADDING / 2 },
  }
  const canReroll = options?.canReroll === true && !hold.resolvedAt && !hold.chosen && !hold.custom
  const rerollAt = canReroll ? { x: x + PADDING, y: custom.y + custom.height + GAP } : undefined
  const bottom = rerollAt ? rerollAt.y + CONTINUE_HEIGHT : custom.y + custom.height
  return {
    box: { x, y, width: HOLD_COLUMN_WIDTH, height: bottom + PADDING - y },
    prompt: { text: promptText, box: promptBox },
    candidates,
    custom,
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

/** A fresh empty "Your own" card added below a picked custom card. */
export function freshCustomCard(candidate: Box): {
  box: Box
  containerHeight: number
  continueAt: { x: number; y: number }
  columnBottom: number
} {
  const y = candidate.y + Math.max(candidate.height, PICK_CARD_HEIGHT) + GAP
  const containerHeight = OUTPUT_HEIGHT - CONTINUE_HEIGHT - PADDING / 2
  const continueAt = { x: candidate.x + PADDING, y: y + containerHeight }
  return {
    box: { x: candidate.x, y, width: candidate.width, height: OUTPUT_HEIGHT },
    containerHeight,
    continueAt,
    columnBottom: continueAt.y + CONTINUE_HEIGHT + PADDING,
  }
}

const PICK_STAMP = 'chainRunnerPick'
export interface PickStamp { runId: string; nodeId: string; heading: string }

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
    ? stamp as unknown as PickStamp : undefined
}
