import type { HoldRecord } from '../engine/types'
import type { Box } from './nodeScene'
import { FRAME_PADDING, type RunFrame } from '../run/runFrame'

/** The drawing geometry of a waiting hold. Its candidates keep their slots when picked. */
export interface HoldColumn {
  box: Box
  prompt: { text: string; box: Box }
  candidates: { heading: string; text: string; box: Box; continueAt: { x: number; y: number } }[]
  custom: Box
}

export const HOLD_COLUMN_WIDTH = 360
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

/** A generic numbered heading gives way to the candidate's first line. */
export function candidateWords(heading: string, body: string): string {
  const first = body.trim().split('\n')[0]?.trim()
  if (!/^Candidate\s+\d+$/i.test(heading.trim()) || !first) return `${heading}\n${body}`.trim()
  return body.trim()
}

export function buildHoldColumn(hold: HoldRecord, x: number, y: number): HoldColumn {
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
  const custom = { x: x + PADDING, y: top, width: HOLD_COLUMN_WIDTH - PADDING * 2, height: OUTPUT_HEIGHT }
  return {
    box: { x, y, width: HOLD_COLUMN_WIDTH, height: custom.y + custom.height + PADDING - y },
    prompt: { text: promptText, box: promptBox },
    candidates,
    custom,
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
  role: 'candidate' | 'continue' | 'column'
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
  if (value.role !== 'candidate' && value.role !== 'continue' && value.role !== 'column') return undefined
  return stamp as HoldStamp
}
