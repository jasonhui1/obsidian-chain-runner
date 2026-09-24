import type { HoldRecord } from '../engine/types'
import type { Box } from './nodeScene'
import { FRAME_PADDING } from '../run/runFrame'
import { directLabelRunId } from './runLabel'
import { buildHoldColumn, buildPickRow, holdStamp, pickRowBoxes, pickStamp, PICK_GAP, type HoldColumn } from './holdColumn'

/** A hold reached inside a pick row: its column at the end of the row, and the room made below it (ADR-0016). */

export interface SceneBlock {
  id: string
  type: string
  x?: number
  y?: number
  width?: number
  height?: number
  frameId?: string | null
  customData?: unknown
  isDeleted?: boolean
}

export interface SceneEdits {
  removed: string[]
  moved: Map<string, { dx: number; dy: number }>
  resized: Map<string, { width?: number; height?: number }>
}

export interface RowHold extends SceneEdits {
  column: HoldColumn
  frameId?: string
}

export interface RowHoldRequest {
  sourceRunId: string
  runId: string
  pick: { nodeId: string; heading: string }
  hold: HoldRecord
  /** The row's panels the new hold has not reached. */
  pending: readonly number[]
  canReroll: boolean
}

const top = (element: SceneBlock): number => element.y ?? 0
const bottom = (element: SceneBlock): number => top(element) + (element.height ?? 0)
const left = (element: SceneBlock): number => element.x ?? 0
const right = (element: SceneBlock): number => left(element) + (element.width ?? 0)

/** The panel index a row element shows: its card, its step name or its line count. */
export function rowIndex(element: SceneBlock): number | undefined {
  const data = element.customData
  if (!data || typeof data !== 'object') return undefined
  const value = data as Record<string, unknown>
  const panel = value.chainRunnerPanel as { index?: unknown } | undefined
  for (const index of [panel?.index, value.chainRunnerPickCount, value.chainRunnerPickStep]) {
    if (typeof index === 'number') return index
  }
  return undefined
}

function blankEdits(): SceneEdits {
  return { removed: [], moved: new Map(), resized: new Map() }
}

function move(edits: SceneEdits, id: string, dx: number, dy: number): void {
  const was = edits.moved.get(id) ?? { dx: 0, dy: 0 }
  edits.moved.set(id, { dx: was.dx + dx, dy: was.dy + dy })
}

/**
 * Moves everything in `frameId` from `line` down, except `kept`, so it starts a gap under `reach`,
 * and grows the columns and frame around it. Run frames below move by the frame's growth.
 */
export function roomBelow(
  scene: readonly SceneBlock[],
  options: { frameId?: string; line: number; reach: Box; kept: (element: SceneBlock) => boolean },
  edits: SceneEdits = blankEdits(),
): SceneEdits {
  const { frameId, line, reach, kept } = options
  const live = scene.filter(element => !element.isDeleted && !edits.removed.includes(element.id))
  const inside = live.filter(element => frameId
    ? element.frameId === frameId
    : !element.frameId && (holdStamp(element) || pickStamp(element)))
  const below = inside.filter(element => !kept(element) && top(element) >= line)
  const reachBottom = reach.y + reach.height
  const shift = below.length > 0 ? Math.max(0, reachBottom + PICK_GAP - Math.min(...below.map(top))) : 0
  if (shift > 0) {
    for (const element of below) move(edits, element.id, 0, shift)
    for (const element of inside) {
      if (kept(element) || holdStamp(element)?.role !== 'column' || element.type !== 'rectangle') continue
      if (top(element) < line && bottom(element) > line) edits.resized.set(element.id, { height: (element.height ?? 0) + shift })
    }
  }
  const frame = frameId ? live.find(element => element.id === frameId) : undefined
  if (!frame) return edits
  const width = Math.max(frame.width ?? 0, reach.x + reach.width + FRAME_PADDING - left(frame))
  const height = Math.max((frame.height ?? 0) + shift, reachBottom + FRAME_PADDING - top(frame))
  const growth = height - (frame.height ?? 0)
  if (width !== frame.width || growth !== 0) edits.resized.set(frame.id, { width, height })
  if (growth <= 0) return edits
  const lower = live.filter(element => element.type === 'frame' && element.id !== frame.id
    && top(element) >= bottom(frame) && left(element) < left(frame) + width && right(element) > left(frame))
  for (const other of lower) {
    move(edits, other.id, 0, growth)
    for (const member of live) if (member.frameId === other.id) move(edits, member.id, 0, growth)
  }
  return edits
}

/**
 * Where a hold reached by a pick row's run goes: the row loses the cards it did not reach,
 * the column starts where the row now ends, and the rows below move down to make room.
 * `undefined` when the row is not on this drawing, or it already shows a hold.
 */
export function rowHold(scene: readonly SceneBlock[], request: RowHoldRequest): RowHold | undefined {
  const { sourceRunId, runId, pick, hold, pending } = request
  const live = scene.filter(element => !element.isDeleted)
  const slot = (element: SceneBlock): boolean => {
    const stamp = holdStamp(element)
    return stamp?.runId === sourceRunId && stamp.nodeId === pick.nodeId && stamp.heading === pick.heading
  }
  const candidate = live.find(element => slot(element) && holdStamp(element)?.role === 'candidate' && element.type !== 'text')
  if (!candidate) return undefined
  if (live.some(element => holdStamp(element)?.runId === runId && holdStamp(element)?.nodeId !== pick.nodeId)) return undefined
  const inRow = (element: SceneBlock): boolean => {
    const stamp = pickStamp(element)
    return stamp?.runId === runId && stamp.nodeId === pick.nodeId
  }
  const row = live.filter(inRow)
  const edits = blankEdits()
  const unreached = new Set(pending)
  for (const element of row) {
    const index = rowIndex(element)
    if (index !== undefined && unreached.has(index)) edits.removed.push(element.id)
  }

  const box = { x: left(candidate), y: top(candidate), width: candidate.width ?? 0, height: candidate.height ?? 0 }
  const cards = row.filter(element => element.type === 'embeddable' && !edits.removed.includes(element.id))
    .sort((one, other) => left(one) - left(other))
  const places = pickRowBoxes(box, cards.length)
  for (const [along, card] of cards.entries()) {
    const dx = (places[along]?.x ?? left(card)) - left(card)
    if (dx === 0) continue
    const index = rowIndex(card)
    for (const element of row) if (rowIndex(element) === index) move(edits, element.id, dx, 0)
  }
  const laid = buildPickRow(box, cards.length)
  const direct = row.find(element => directLabelRunId(element) === runId)
  if (direct) move(edits, direct.id, laid.direct.x - left(direct), 0)

  const column = buildHoldColumn(hold, laid.right, box.y, { canReroll: request.canReroll })
  const frameId = candidate.frameId ?? undefined
  roomBelow(live, { frameId, line: box.y, reach: column.box, kept: element => inRow(element) || slot(element) }, edits)
  return { ...edits, column, ...(frameId ? { frameId } : {}) }
}
