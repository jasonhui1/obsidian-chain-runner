import { waitingHolds, type HoldRecord, type LayoutPanel, type RunMeta } from '../engine/types'
import type { Box } from './nodeScene'
import { FRAME_PADDING } from '../run/runFrame'
import { pickPanelIndexes } from '../run/pickPanels'
import type { RerunLanding } from '../run/rerunWatch'
import { directLabelRunId } from './runLabel'
import {
  buildHoldColumn, buildPickRow, holdStamp, nextOwnWordsCard, ownWordsHeight, pickRowBoxes, pickStamp, typedWords,
  PICK_COUNT, PICK_GAP, PICK_STEP, type HoldColumn, type HoldStamp, type OwnWordsCard,
} from './holdColumn'

/** Pick rows on the scene: where a first pick lands, and a hold reached inside one (ADR-0016). */

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
  text?: string
  originalText?: string
  containerId?: string | null
}

export interface SceneEdits {
  removed: string[]
  moved: Map<string, { dx: number; dy: number }>
  resized: Map<string, { width?: number; height?: number }>
}

/** The holds a picked run stopped at further on: each with the row's panels after it, and every card the row drops. */
export interface HeldInRow {
  holds: { hold: HoldRecord; pending: number[] }[]
  unreached: number[]
}

export interface RowHold extends SceneEdits {
  columns: { column: HoldColumn; hold: HoldRecord; pending: number[] }[]
  frameId?: string
}

type Pick = NonNullable<RerunLanding['pick']>

export interface RowHoldRequest {
  sourceRunId: string
  runId: string
  pick: Pick
  held: HeldInRow
  canReroll: boolean
}

/** A candidate's box, or the box for the reader's own words. */
const isSlotBox = (element: SceneBlock): boolean => {
  const role = holdStamp(element)?.role
  return (role === 'candidate' || role === 'custom') && element.type !== 'text'
}
const top = (element: SceneBlock): number => element.y ?? 0
const bottom = (element: SceneBlock): number => top(element) + (element.height ?? 0)
const left = (element: SceneBlock): number => element.x ?? 0
const right = (element: SceneBlock): number => left(element) + (element.width ?? 0)
const slotKey = (runId: string, nodeId: string, heading: string): string => `${runId}\n${nodeId}\n${heading}`
export const boxOf = (element: SceneBlock): Box => ({ x: left(element), y: top(element), width: element.width ?? 0, height: element.height ?? 0 })

export function heldInRow(run: RunMeta, pick: Pick, panels: readonly LayoutPanel[]): HeldInRow | undefined {
  if (run.status !== 'waiting') return undefined
  const holds = waitingHolds(run.holds).filter(one => one.nodeId !== pick.nodeId).map(hold => {
    const after = new Set(pickPanelIndexes(run, hold.nodeId, panels))
    return { hold, pending: pick.pending.filter(index => after.has(index)) }
  })
  if (holds.length === 0) return undefined
  const own = new Set(holds.map(one => one.hold.nodeId))
  const unreached = pick.pending.filter(index => own.has(panels[index]?.node ?? '') || holds.some(one => one.pending.includes(index)))
  return { holds, unreached }
}

/** The panel index a row element shows: its card, its step name or its line count. */
export function rowIndex(element: SceneBlock): number | undefined {
  const data = element.customData
  if (!data || typeof data !== 'object') return undefined
  const value = data as Record<string, unknown>
  const panel = value.chainRunnerPanel as { index?: unknown } | undefined
  for (const index of [panel?.index, value[PICK_COUNT], value[PICK_STEP]]) {
    if (typeof index === 'number') return index
  }
  return undefined
}

function blankEdits(removed: string[] = []): SceneEdits {
  return { removed, moved: new Map(), resized: new Map() }
}

function move(edits: SceneEdits, id: string, dx: number, dy: number): void {
  const was = edits.moved.get(id) ?? { dx: 0, dy: 0 }
  edits.moved.set(id, { dx: was.dx + dx, dy: was.dy + dy })
}

/** Where the slot an element belongs to starts: a candidate's lines and the rows beside it go with their candidate. */
function slotTops(scene: readonly SceneBlock[]): (element: SceneBlock) => number {
  const tops = new Map<string, number>()
  for (const element of scene) {
    const stamp = holdStamp(element)
    if (stamp && isSlotBox(element)) tops.set(slotKey(stamp.runId, stamp.nodeId, stamp.heading), top(element))
  }
  return element => {
    const hold = holdStamp(element)
    const pick = pickStamp(element)
    const key = hold && hold.role !== 'column' && hold.role !== 'reroll' ? slotKey(hold.runId, hold.nodeId, hold.heading)
      : pick?.from ? slotKey(pick.from, pick.nodeId, pick.heading) : undefined
    return (key === undefined ? undefined : tops.get(key)) ?? top(element)
  }
}

/**
 * Moves every slot in `frameId` that starts at `from` or lower, except what `stays`, to a gap under `clear`,
 * and grows the columns and frame around it. Run frames below move by the frame's growth.
 */
export function roomBelow(
  scene: readonly SceneBlock[],
  options: { frameId?: string; from: number; clear: Box; stays: (element: SceneBlock) => boolean },
  edits: SceneEdits = blankEdits(),
): SceneEdits {
  const { frameId, from, clear, stays } = options
  const live = scene.filter(element => !element.isDeleted && !edits.removed.includes(element.id))
  const inside = live.filter(element => frameId
    ? element.frameId === frameId
    : !element.frameId && (holdStamp(element) || pickStamp(element)))
  const slotTop = slotTops(live)
  const below = inside.filter(element => !stays(element) && slotTop(element) >= from)
  const clearBottom = clear.y + clear.height
  const shift = below.length > 0 ? Math.max(0, clearBottom + PICK_GAP - Math.min(...below.map(top))) : 0
  if (shift > 0) {
    for (const element of below) move(edits, element.id, 0, shift)
    for (const element of inside) {
      if (stays(element) || holdStamp(element)?.role !== 'column' || element.type !== 'rectangle') continue
      if (top(element) < from && bottom(element) > from) edits.resized.set(element.id, { height: (element.height ?? 0) + shift })
    }
  }
  const frame = frameId ? live.find(element => element.id === frameId) : undefined
  if (!frame) return edits
  const width = Math.max(frame.width ?? 0, clear.x + clear.width + FRAME_PADDING - left(frame))
  const height = Math.max((frame.height ?? 0) + shift, clearBottom + FRAME_PADDING - top(frame))
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
 * Where the holds a pick row's run stopped at go: the row drops the cards it did not reach,
 * the columns start where the row now ends, and the slots below move down to make room.
 */
export function rowHold(scene: readonly SceneBlock[], request: RowHoldRequest): RowHold | undefined {
  const { sourceRunId, runId, pick, held } = request
  const live = scene.filter(element => !element.isDeleted)
  const ofSlot = (element: SceneBlock): boolean => {
    const stamp = holdStamp(element)
    return stamp?.runId === sourceRunId && stamp.nodeId === pick.nodeId && stamp.heading === pick.heading
  }
  const candidate = live.find(element => ofSlot(element) && isSlotBox(element))
  if (!candidate || held.holds.length === 0) return undefined
  if (live.some(element => holdStamp(element)?.runId === runId && holdStamp(element)?.nodeId !== pick.nodeId)) return undefined
  const inRow = (element: SceneBlock): boolean => {
    const stamp = pickStamp(element)
    return stamp?.runId === runId && stamp.nodeId === pick.nodeId
  }
  const row = live.filter(inRow)
  const unreached = new Set(held.unreached)
  const edits = blankEdits(row.filter(element => unreached.has(rowIndex(element) ?? -1)).map(element => element.id))

  const box = boxOf(candidate)
  const cards = row.filter(element => element.type === 'embeddable' && !edits.removed.includes(element.id))
    .sort((one, other) => left(one) - left(other))
  const cardBoxes = pickRowBoxes(box, cards.length)
  for (const [along, card] of cards.entries()) {
    const dx = (cardBoxes[along]?.x ?? left(card)) - left(card)
    if (dx === 0) continue
    const index = rowIndex(card)
    for (const element of row) if (rowIndex(element) === index) move(edits, element.id, dx, 0)
  }
  const shortened = buildPickRow(box, cards.length)
  const direct = row.find(element => directLabelRunId(element) === runId)
  if (direct) move(edits, direct.id, shortened.direct.x - left(direct), 0)

  let x = shortened.right
  const columns = held.holds.map(({ hold, pending }) => {
    const column = buildHoldColumn(hold, x, box.y, { canReroll: request.canReroll })
    x = column.box.x + column.box.width + PICK_GAP
    return { column, hold, pending }
  })
  const clear = {
    x: shortened.right,
    y: box.y,
    width: x - PICK_GAP - shortened.right,
    height: Math.max(...columns.map(({ column }) => column.box.y + column.box.height)) - box.y,
  }
  const frameId = candidate.frameId ?? undefined
  roomBelow(live, { frameId, from: box.y, clear, stays: element => inRow(element) || ofSlot(element) }, edits)
  return { ...edits, columns, ...(frameId ? { frameId } : {}) }
}

/** The element of one hold, in one role, that `match` also accepts. */
export function findHeld<Element extends SceneBlock>(
  scene: readonly Element[],
  role: HoldStamp['role'],
  runId: string,
  nodeId: string,
  match: (element: Element, stamp: HoldStamp) => boolean = () => true,
): Element | undefined {
  return scene.find(element => {
    const stamp = holdStamp(element)
    return stamp?.role === role && stamp.runId === runId && stamp.nodeId === nodeId && match(element, stamp)
  })
}

export interface PickRowRequest {
  runId: string
  /** The runs the landing reran; the first is the one whose candidate the row sits beside. */
  from: readonly string[]
  pick: Pick
  count: number
}

/** A first pick's row beside its card: what it changes on the scene, and where its own elements go. */
export interface PickRow extends SceneEdits {
  /** The card the row sits beside, drawn solid once picked. */
  candidate: string
  /** Every scene element the row changes, in the order to copy them. */
  touched: string[]
  frameId?: string
  row: ReturnType<typeof buildPickRow>
  /** A used own-words card: its words, their new text when it changes, and the empty card that waits below. */
  ownWords?: { wordsId?: string; text?: string; next: OwnWordsCard }
}

/** Whether the landing's row is already on the scene. */
export function pickRowDrawn(scene: readonly SceneBlock[], runId: string, pick: Pick): boolean {
  return scene.some(element => {
    const stamp = pickStamp(element)
    return stamp?.runId === runId && stamp.nodeId === pick.nodeId && stamp.heading === pick.heading
  })
}

/** Where a first pick's row goes, or `undefined` when its card is not on the scene. */
export function pickRow(scene: readonly SceneBlock[], request: PickRowRequest): PickRow | undefined {
  const { runId, from, pick, count } = request
  const sourceRunId = from[0] ?? runId
  const card = (role: HoldStamp['role'], heading: string): SceneBlock | undefined =>
    findHeld(scene, role, sourceRunId, pick.nodeId, (element, stamp) => element.type !== 'text' && stamp.heading === heading)
  // Only the empty own-words card is free; a used one already has its row.
  const candidate = pick.words === undefined ? card('candidate', pick.heading) : card('custom', '')
  if (!candidate) return undefined
  const frame = scene.find(element => element.type === 'frame' && element.id === candidate.frameId)
  const reroll = scene.find(element => {
    const stamp = holdStamp(element)
    return stamp?.role === 'reroll' && (stamp.runId === runId || from.includes(stamp.runId)) && stamp.nodeId === pick.nodeId
  })
  const row = buildPickRow(boxOf(candidate), count)
  const edits = blankEdits(reroll ? [reroll.id] : [])
  const touched = [candidate, frame, reroll]
  let frameHeight: number | undefined
  let ownWords: PickRow['ownWords']
  if (holdStamp(candidate)?.role === 'custom') {
    const words = scene.find(element => element.type === 'text' && element.containerId === candidate.id)
    const continueLine = findHeld(scene, 'continue', sourceRunId, pick.nodeId, (_, stamp) => stamp.custom === true)
    const column = findHeld(scene, 'column', sourceRunId, pick.nodeId, element => element.type === 'rectangle')
    touched.push(words, continueLine, column)
    if (continueLine) edits.removed.push(continueLine.id)
    // A rebuilt row finds the card still empty; typed words can still start with the placeholder.
    const text = words && (typedWords(words.originalText ?? words.text ?? '') || (pick.words ?? pick.heading))
    const changed = text !== undefined && text !== words?.originalText
    const used = changed ? { ...boxOf(candidate), height: ownWordsHeight(boxOf(candidate), text) } : boxOf(candidate)
    if (changed) edits.resized.set(candidate.id, { height: used.height })
    const next = nextOwnWordsCard(used)
    if (column) edits.resized.set(column.id, { height: Math.max(column.height ?? 0, next.columnBottom - top(column)) })
    if (frame) frameHeight = Math.max(frame.height ?? 0, next.columnBottom + FRAME_PADDING - top(frame))
    ownWords = { ...(words ? { wordsId: words.id } : {}), ...(changed ? { text } : {}), next }
  }
  if (frame) {
    const width = Math.max(frame.width ?? 0, row.right + 32 - left(frame))
    edits.resized.set(frame.id, { width, ...(frameHeight === undefined ? {} : { height: frameHeight }) })
  }
  return {
    ...edits,
    candidate: candidate.id,
    touched: touched.filter(element => element !== undefined).map(element => element.id),
    ...(frame ? { frameId: frame.id } : {}),
    row,
    ...(ownWords ? { ownWords } : {}),
  }
}
