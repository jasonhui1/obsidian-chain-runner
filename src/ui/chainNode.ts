import { GREY, INK, LINK_BLUE } from './ink'
import { momentOf, parameterToAsk, type ChainSummary } from '../engine/types'

/**
 * What a chain node *is*, as pure shapes: one box holding the chain's name, its
 * moment, its dropdown, a run count and `▶ Run`. Linked actions need their own
 * elements; `src/ui/excalidraw.ts` puts the shapes on a scene.
 */

/**
 * Which part of the node an element is. Stored on it, so a click knows what was
 * clicked. `title` is a legacy alias for `chain` (ADR-0009).
 */
export type ChainNodeRole =
  | 'box'
  | 'chain'
  | 'moment'
  | 'parameter'
  | 'run'
  | 'run-count'
  | 'run-count-box'
  | 'title'

/**
 * The node's identity, in each element's `customData`, so a reader who copies
 * one line still gets something that knows its chain.
 */
export interface ChainNodeData {
  /** Ties the node's elements together. Not an element id — those change on copy. */
  nodeId: string
  role: ChainNodeRole
  /** The chain's slug, which is what the engine is asked for again later. */
  chain: string
  /** The chain's name, so a node on a drawing reads without the engine. */
  chainName: string
  parameterName?: string
  parameterValue?: string
  /** The chain's moment in full, which only the node records once it is drawn. */
  moment?: string
  /** The box width these lines were cut to fit, so a resize is noticed once. */
  laidOut?: number
}

/** One element of the node, in the shapes Excalidraw is later asked for. */
export interface ChainNodeElement extends MaybeNodeElement {
  role: ChainNodeRole
  shape: 'rect' | 'text'
  x: number
  y: number
  width: number
  height: number
  text?: string
  fontSize?: number
  textAlign?: 'left' | 'right' | 'center'
  strokeColor: string
  /** An actionable element's own scheme; absent everywhere else. */
  link?: string
  customData: { chainRunner: ChainNodeData }
}

/** Anything that might be a node's element: a scene element, or one just built. */
export interface MaybeNodeElement {
  customData?: unknown
  /** Excalidraw's own grouping. Re-made on copy, which is what separates two copies. */
  groupIds?: readonly string[]
  x?: number
  y?: number
}

/**
 * The links the two clickable lines carry. A scheme of our own, so a click that
 * escapes the hook fails as an unopenable link rather than creating a note.
 */
export const CHAIN_LINK = 'chain-runner://chain'
export const PARAMETER_LINK = 'chain-runner://parameter'
export const RUN_LINK = 'chain-runner://run'
export const RUN_COUNT_LINK = 'chain-runner://run-count'

/** Said in the dropdown line before anything has been picked. */
export const UNSET_PARAMETER = 'unset'

/** Said on the chain line of a node placed before any chain was picked. */
export const UNSET_CHAIN = 'pick a chain'

/** The key the node's identity lives under, inside Excalidraw's `customData`. */
const DATA_KEY = 'chainRunner'

/** The node's measurements; its colours are `./ink.ts`. */
const WIDTH = 300
const PADDING = 14
const LINE_GAP = 6
const RUN_COUNT_BOX_WIDTH = 30
const RUN_COUNT_BOX_HEIGHT = 24
const RUN_COUNT_GAP = 8
const RUN_COUNT_TEXT_WIDTH = 18
export const MIN_RUN_COUNT = 1
export const MAX_RUN_COUNT = 10

/** Parses a whole run count from the node's saved or entered value. */
export function parseRunCount(value: string): number | undefined {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const count = Number(trimmed)
  return Number.isInteger(count) && count >= MIN_RUN_COUNT && count <= MAX_RUN_COUNT ? count : undefined
}

const TITLE_SIZE = 20
const LINE_SIZE = 16
/** Excalidraw's own line height for its hand-drawn font. */
const LINE_HEIGHT = 1.25
/** Excalidraw's font is not measurable here; this is the ratio its 20px glyphs average. */
const GLYPH_WIDTH = 0.58

/** The chain's mark in the title, so a node reads as one at a glance. */
const TITLE_MARK = '⛓'
/** Says the value can be changed, in the picker's own idiom. */
const DROPDOWN_MARK = '▾'
const RUN_LABEL = '▶ Run'

export interface ChainNodeOptions {
  nodeId: string
  /** The pick for the chain's dropdown, when the reader has made one. */
  parameterValue?: string
}

/** The chain line: the mark, the chain's name, and the marker saying it can be changed. */
export function chainLabel(name: string | undefined): string {
  return `${TITLE_MARK} ${name || UNSET_CHAIN} ${DROPDOWN_MARK}`
}

/** The dropdown line: the parameter's name, the marker, and what it is set to. */
export function parameterLabel(name: string, value: string | undefined): string {
  return `${name} ${DROPDOWN_MARK} ${value || UNSET_PARAMETER}`
}

/**
 * The node's elements, top-left at the origin — the caller moves the set to the
 * cursor. The box comes first so every line sits on top of it.
 */
export function buildChainNode(chain: ChainSummary | undefined, options: ChainNodeOptions): ChainNodeElement[] {
  const parameter = chain ? parameterToAsk(chain) : undefined
  const data = (role: ChainNodeRole): { chainRunner: ChainNodeData } => ({
    chainRunner: {
      nodeId: options.nodeId,
      role,
      chain: chain?.slug ?? '',
      chainName: chain?.name ?? '',
      laidOut: WIDTH,
      ...(chain && momentOf(chain) ? { moment: momentOf(chain) } : {}),
      ...(parameter ? { parameterName: parameter.name } : {}),
      ...(options.parameterValue ? { parameterValue: options.parameterValue } : {}),
    },
  })

  const lines: ChainNodeElement[] = []
  let y = PADDING

  const lineWidth = WIDTH - PADDING * 2
  const line = (role: ChainNodeRole, text: string, fontSize: number, strokeColor: string, link?: string): void => {
    const height = Math.round(fontSize * LINE_HEIGHT)
    lines.push({
      role,
      shape: 'text',
      x: PADDING,
      y,
      width: lineWidth,
      height,
      text: oneLine(text, fontSize, lineWidth),
      fontSize,
      textAlign: 'left',
      strokeColor,
      ...(link ? { link } : {}),
      customData: data(role),
    })
    y += height + LINE_GAP
  }

  line('chain', chainLabel(chain?.name), TITLE_SIZE, LINK_BLUE, CHAIN_LINK)
  const moment = chain ? momentOf(chain) : ''
  if (moment) line('moment', `“${moment}”`, LINE_SIZE, GREY)
  if (parameter) {
    line('parameter', parameterLabel(parameter.name, options.parameterValue), LINE_SIZE, LINK_BLUE, PARAMETER_LINK)
  }

  // The count picker sits after Run in a box on the same line.
  const runWidth = textWidth(RUN_LABEL, LINE_SIZE)
  const runHeight = Math.round(LINE_SIZE * LINE_HEIGHT)
  const controls = runControlLayout(0, WIDTH, runWidth)
  lines.push(...runCountElements(data('run').chainRunner, controls.boxX, y))
  lines.push({
    role: 'run',
    shape: 'text',
    x: controls.runX,
    y,
    width: runWidth,
    height: runHeight,
    text: RUN_LABEL,
    fontSize: LINE_SIZE,
    textAlign: 'right',
    strokeColor: LINK_BLUE,
    link: RUN_LINK,
    customData: data('run'),
  })
  y += runHeight

  const box: ChainNodeElement = {
    role: 'box',
    shape: 'rect',
    x: 0,
    y: 0,
    width: WIDTH,
    height: y + PADDING,
    strokeColor: INK,
    customData: data('box'),
  }
  return [box, ...lines]
}

/** Roughly how wide a label draws at this size; Excalidraw re-measures on its own. */
function textWidth(text: string, fontSize: number): number {
  return Math.round(text.length * fontSize * GLYPH_WIDTH)
}

/**
 * A line trimmed to one, with an ellipsis where it was cut: Excalidraw would
 * otherwise wrap it and push the lines below out through the box. The width is
 * an estimate (`GLYPH_WIDTH`), so this guards a runaway line, not a precise fit.
 */
function oneLine(text: string, fontSize: number, width: number): string {
  const fits = Math.floor(width / (fontSize * GLYPH_WIDTH))
  return text.length <= fits ? text : `${text.slice(0, Math.max(1, fits - 1)).trimEnd()}…`
}

/**
 * The node identity stamped on an element, or `undefined` when it is not a chain
 * node's. Every field is checked: `customData` may be whatever an older version
 * of this plugin, or another plugin, wrote.
 */
export function chainNodeData(element: MaybeNodeElement): ChainNodeData | undefined {
  const custom = element.customData
  if (typeof custom !== 'object' || custom === null) return undefined
  const stamp = (custom as Record<string, unknown>)[DATA_KEY]
  if (typeof stamp !== 'object' || stamp === null) return undefined
  const { nodeId, role, chain, chainName, parameterName, parameterValue, moment, laidOut } =
    stamp as Record<string, unknown>
  if (typeof nodeId !== 'string' || typeof chain !== 'string' || typeof chainName !== 'string') return undefined
  if (!isRole(role)) return undefined
  return {
    nodeId,
    role,
    chain,
    chainName,
    ...(typeof parameterName === 'string' ? { parameterName } : {}),
    ...(typeof parameterValue === 'string' ? { parameterValue } : {}),
    ...(typeof moment === 'string' ? { moment } : {}),
    ...(typeof laidOut === 'number' ? { laidOut } : {}),
  }
}

function isRole(role: unknown): role is ChainNodeRole {
  return ROLES.includes(role as ChainNodeRole)
}

const ROLES: ChainNodeRole[] = [
  'box',
  'chain',
  'moment',
  'parameter',
  'run',
  'run-count',
  'run-count-box',
  'title',
]

/** The role a stored one means now, so a node drawn before the chain line was clickable still reads. */
export function chainNodeRole(role: ChainNodeRole): Exclude<ChainNodeRole, 'title'> {
  return role === 'title' ? 'chain' : role
}

/** A node placed by the toolbar button, before its chain was picked. */
export function chainIsUnset(data: ChainNodeData): boolean {
  return data.chain === ''
}

/**
 * Which node on the drawing an edit is aimed at. The id alone is not enough —
 * copies share it — so the group tells copies apart; an ungrouped element has
 * none and is read as still part of its node.
 */
export interface NodeTarget {
  nodeId: string
  groupIds?: readonly string[]
}

/** One element to write back, and what changes on it. */
export interface NodeEdit<E> {
  element: E
  /** The new label, on the one line whose words change. */
  text?: string
  /** The `run` line sits before the count box; a grown label keeps that right edge. */
  keepRightEdge?: boolean
  /** Where the line sits now, when a re-shaped node moved it. */
  y?: number
  /** The box's own height, when the lines inside it changed. */
  height?: number
  /** Where the line starts, when the box it sits in changed width. */
  x?: number
  /** How wide the line may draw, when the box it sits in changed width. */
  width?: number
  /** Put back to the size the node was designed at, after a drag scaled it. */
  fontSize?: number
  data: ChainNodeData
}

/**
 * What changes when a node's parameter is set to `value`. Every element is
 * re-stamped, not just the line shown: a stale value on the others would run as
 * something the node does not say once a reader copies one of them.
 */
export function parameterEdits<E extends MaybeNodeElement>(
  scene: readonly E[],
  target: NodeTarget,
  value: string,
): NodeEdit<E>[] {
  const edits: NodeEdit<E>[] = []
  for (const element of scene) {
    const data = nodeElementData(element, target)
    if (!data) continue
    const next: ChainNodeData = { ...data, parameterValue: value }
    edits.push({
      element,
      ...(data.role === 'parameter' && data.parameterName
        ? { text: parameterLabel(data.parameterName, value) }
        : {}),
      data: next,
    })
  }
  return edits
}

/** Rewrites the visible run count on the one node copy the reader picked. */
export function runCountEdits<E extends MaybeNodeElement>(
  scene: readonly E[],
  target: NodeTarget,
  count: number,
): NodeEdit<E>[] {
  for (const element of scene) {
    const data = nodeElementData(element, target)
    if (data?.role === 'run-count') return [{ element, text: String(count), data }]
  }
  return []
}

/** What the node becomes when its chain is changed (ADR-0009). */
export interface NodeReshape<E> {
  /** Elements already on the drawing, with their new words and place. */
  edits: NodeEdit<E>[]
  /** Lines the new chain has and the old did not, at their place on the drawing. */
  additions: ChainNodeElement[]
  /** Lines the new chain does not have. */
  removals: E[]
}

/** An empty reshape: the node is no longer on the drawing. */
const NOTHING: NodeReshape<never> = { edits: [], additions: [], removals: [] }

/** Moves chain-owned lines vertically and keeps the Run/count pair at the right edge (ADR-0009). */
export function chainEdits<E extends MaybeNodeElement & { width?: number; height?: number }>(
  scene: readonly E[],
  target: NodeTarget,
  chain: ChainSummary,
  parameterValue?: string,
): NodeReshape<E> {
  const mine = scene.flatMap(element => {
    const data = nodeElementData(element, target)
    return data ? [{ element, role: chainNodeRole(data.role) }] : []
  })
  const box = mine.find(one => one.role === 'box')
  if (!box) return NOTHING

  const x = box.element.x ?? 0
  const y = box.element.y ?? 0
  const width = box.element.width ?? WIDTH
  const wanted = buildChainNode(chain, {
    nodeId: target.nodeId,
    ...(parameterValue ? { parameterValue } : {}),
  })

  const edits: NodeEdit<E>[] = []
  const additions: ChainNodeElement[] = []
  for (const shape of wanted) {
    const found = mine.find(one => one.role === shape.role)
    if (!found) {
      const additionX = runControlX(shape.role, x, width, shape.width) ?? x + shape.x
      additions.push({ ...shape, x: additionX, y: y + shape.y })
      continue
    }
    const editX = runControlX(shape.role, x, width, found.element.width ?? shape.width)
    edits.push({
      element: found.element,
      ...(editX !== undefined ? { x: editX } : {}),
      y: y + shape.y,
      // The `run` line's words are its run's, not its chain's.
      ...(shape.role === 'run' || shape.role === 'run-count' || shape.role === 'box' || shape.role === 'run-count-box'
        ? {}
        : { text: shape.text ?? '' }),
      ...(shape.role === 'box' ? { height: shape.height } : {}),
      data: shape.customData.chainRunner,
    })
  }

  const kept = new Set(wanted.map(shape => shape.role))
  return { edits, additions, removals: mine.filter(one => !kept.has(one.role)).map(one => one.element) }
}

/**
 * Every node on the scene, one target each. The box is the one element a node
 * has exactly one of; a copy carries the same `nodeId` and is told apart by the
 * group Excalidraw re-made for it.
 */
export function nodeTargets(scene: readonly MaybeNodeElement[]): NodeTarget[] {
  return scene.flatMap(element => {
    const data = chainNodeData(element)
    if (!data || chainNodeRole(data.role) !== 'box') return []
    return [{ nodeId: data.nodeId, ...(element.groupIds ? { groupIds: element.groupIds } : {}) }]
  })
}

/** The lines of a node, top to bottom, which is the order they are laid out in. */
const STACK: ChainNodeRole[] = ['chain', 'title', 'moment', 'parameter']

/** What a line's words are before they were ever cut to fit. */
function fullText(data: ChainNodeData, shown: string): string {
  const role = chainNodeRole(data.role)
  if (role === 'chain') return chainLabel(data.chainName)
  if (role === 'parameter' && data.parameterName) {
    return parameterLabel(data.parameterName, data.parameterValue)
  }
  // The moment of a node drawn before it was kept, and the run's own words.
  if (role === 'moment' && data.moment) return `“${data.moment}”`
  return shown
}

/**
 * What changes when the reader drags a node wider or narrower: every line cut
 * again to the box's new width, at the size the node was designed at rather
 * than the size a drag scaled it to (ADR-0010). Empty when the box is still the
 * width its lines were cut for, so a scene that has settled is never written.
 */
export function reflowEdits<
  E extends MaybeNodeElement & { text?: string; fontSize?: number; width?: number; height?: number },
>(
  scene: readonly E[],
  target: NodeTarget,
): NodeEdit<E>[] {
  const mine = scene.flatMap(element => {
    const data = nodeElementData(element, target)
    return data ? [{ element, data, role: chainNodeRole(data.role) }] : []
  })
  const box = mine.find(one => one.role === 'box')
  const width = box?.element.width
  if (!box || width === undefined) return []
  if (Math.round(width) === Math.round(box.data.laidOut ?? WIDTH)) return []

  const lineWidth = width - PADDING * 2
  const left = box.element.x ?? 0
  const top = box.element.y ?? 0
  const edits: NodeEdit<E>[] = []
  let y = PADDING

  for (const role of STACK) {
    const found = mine.find(one => one.role === role)
    if (!found) continue
    const fontSize = role === 'chain' || role === 'title' ? TITLE_SIZE : LINE_SIZE
    const height = Math.round(fontSize * LINE_HEIGHT)
    edits.push({
      element: found.element,
      x: left + PADDING,
      y: top + y,
      width: lineWidth,
      fontSize,
      text: oneLine(fullText(found.data, found.element.text ?? ''), fontSize, lineWidth),
      data: { ...found.data, laidOut: width },
    })
    y += height + LINE_GAP
  }

  const runCountBox = mine.find(one => one.role === 'run-count-box')
  const runCount = mine.find(one => one.role === 'run-count')
  const run = mine.find(one => one.role === 'run')
  if (run) {
    const height = Math.round(LINE_SIZE * LINE_HEIGHT)
    const controls = runControlLayout(
      left,
      width,
      run.element.width ?? 0,
      runCountBox?.element.width ?? 0,
      runCount?.element.width ?? RUN_COUNT_TEXT_WIDTH,
    )
    edits.push({
      element: run.element,
      // The words are the run's, not the box's; only where they sit changes.
      x: controls.runX,
      y: top + y,
      fontSize: LINE_SIZE,
      data: { ...run.data, laidOut: width },
    })
    if (runCountBox) {
      const boxHeight = runCountBox.element.height ?? RUN_COUNT_BOX_HEIGHT
      edits.push({
        element: runCountBox.element,
        x: controls.boxX,
        y: top + y + (height - boxHeight) / 2,
        data: { ...runCountBox.data, laidOut: width },
      })
    }
    if (runCount) {
      edits.push({
        element: runCount.element,
        x: controls.countX,
        y: top + y,
        fontSize: LINE_SIZE,
        data: { ...runCount.data, laidOut: width },
      })
    }
    y += height
  }

  edits.push({ element: box.element, y: top, height: y + PADDING, data: { ...box.data, laidOut: width } })
  return edits
}

/** Adds run-count data to nodes already on a drawing before this field existed. */
export function runCountUpgrade<E extends MaybeNodeElement & { width?: number; height?: number; text?: string }>(
  scene: readonly E[],
  target: NodeTarget,
): NodeReshape<E> {
  const mine = scene.flatMap(element => {
    const data = nodeElementData(element, target)
    return data ? [{ element, data, role: chainNodeRole(data.role) }] : []
  })
  const box = mine.find(one => one.role === 'box')
  const run = mine.find(one => one.role === 'run')
  if (!box || !run) return NOTHING
  const existingBox = mine.find(one => one.role === 'run-count-box')
  const existingCount = mine.find(one => one.role === 'run-count')
  if (existingBox && existingCount) return NOTHING

  const left = box.element.x ?? 0
  const top = box.element.y ?? 0
  const width = box.element.width ?? WIDTH
  const rowY = run.element.y ?? top + (box.element.height ?? 0) - PADDING - Math.round(LINE_SIZE * LINE_HEIGHT)
  const runWidth = run.element.width ?? textWidth(run.element.text ?? RUN_LABEL, LINE_SIZE)
  const controls = runControlLayout(left, width, runWidth)
  const runEdit: NodeEdit<E> = {
    element: run.element,
    x: controls.runX,
    data: run.data,
  }
  const boxEdit: NodeEdit<E> = { element: box.element, data: box.data }
  const shapes = runCountElements(run.data, controls.boxX, rowY)
  const existingRoles = new Set<ChainNodeRole>(mine.map(one => one.role))
  const additions = shapes.filter(shape => !existingRoles.has(shape.role))
  return { edits: [boxEdit, runEdit], additions, removals: [] }
}

function runCountElements(data: ChainNodeData, x: number, y: number): ChainNodeElement[] {
  const height = Math.round(LINE_SIZE * LINE_HEIGHT)
  const box: ChainNodeElement = {
    role: 'run-count-box',
    shape: 'rect',
    x,
    y: (height - RUN_COUNT_BOX_HEIGHT) / 2 + y,
    width: RUN_COUNT_BOX_WIDTH,
    height: RUN_COUNT_BOX_HEIGHT,
    strokeColor: INK,
    link: RUN_COUNT_LINK,
    customData: { chainRunner: { ...data, role: 'run-count-box' } },
  }
  const count: ChainNodeElement = {
    role: 'run-count',
    shape: 'text',
    x: centeredTextX(x, RUN_COUNT_BOX_WIDTH, RUN_COUNT_TEXT_WIDTH),
    y,
    width: RUN_COUNT_TEXT_WIDTH,
    height,
    text: '1',
    fontSize: LINE_SIZE,
    textAlign: 'center',
    strokeColor: LINK_BLUE,
    link: RUN_COUNT_LINK,
    customData: { chainRunner: { ...data, role: 'run-count' } },
  }
  return [box, count]
}

function runControlLayout(
  left: number,
  width: number,
  runWidth: number,
  boxWidth = RUN_COUNT_BOX_WIDTH,
  countWidth = RUN_COUNT_TEXT_WIDTH,
): { runX: number; boxX: number; countX: number } {
  const boxX = left + width - PADDING - boxWidth
  return {
    runX: boxX - RUN_COUNT_GAP - runWidth,
    boxX,
    countX: centeredTextX(boxX, boxWidth, countWidth),
  }
}

function runControlX(role: ChainNodeRole, left: number, width: number, elementWidth: number): number | undefined {
  if (role === 'run') return runControlLayout(left, width, elementWidth).runX
  if (role === 'run-count-box') return runControlLayout(left, width, 0, elementWidth).boxX
  if (role === 'run-count') return runControlLayout(left, width, 0, RUN_COUNT_BOX_WIDTH, elementWidth).countX
  return undefined
}

function centeredTextX(boxX: number, boxWidth: number, textWidth: number): number {
  return boxX + (boxWidth - textWidth) / 2
}

/** The one test for "is this element part of that node", used reading and writing. */
export function nodeElementData(element: MaybeNodeElement, target: NodeTarget): ChainNodeData | undefined {
  const data = chainNodeData(element)
  if (!data || data.nodeId !== target.nodeId) return undefined
  return sameNode(target, element) ? data : undefined
}

/** Whether an element belongs to the copy of the node that was clicked. */
function sameNode(target: NodeTarget, element: MaybeNodeElement): boolean {
  const theirs = element.groupIds ?? []
  const ours = target.groupIds ?? []
  if (theirs.length === 0 || ours.length === 0) return true
  return theirs.some(group => ours.includes(group))
}

/**
 * What a node says about the run it last started. `total` comes from the
 * engine's layout frame, so it is absent until the first frame arrives.
 */
export type NodeRunStatus =
  | { kind: 'idle' }
  | { kind: 'running'; done: number; total?: number }
  | { kind: 'done' }
  | { kind: 'waiting' }
  /** `error` is the engine's own words for what went wrong, when it had any. */
  | { kind: 'failed'; error?: string }

/**
 * The `▶ Run` line's words. A settled run keeps `▶ Run` on the line, because it
 * is still the thing you click to run again; a running one does not.
 */
export function runLabel(status: NodeRunStatus): string {
  if (status.kind === 'running') {
    return status.total === undefined ? '⏳ running' : `⏳ ${status.done}/${status.total}`
  }
  if (status.kind === 'done') return `✓ done · ${RUN_LABEL}`
  if (status.kind === 'waiting') return '⏸ waiting for you'
  if (status.kind === 'failed') return `✕ ${failureWords(status.error)} · ${RUN_LABEL}`
  return RUN_LABEL
}

const NEWLINE = '\n'

/**
 * What is left for the message beside the mark, `▶ Run` and the count field.
 * The full text is in the Notice and the run's notes (ADR-0003).
 */
const FAILURE_ROOM =
  WIDTH - PADDING * 2 - RUN_COUNT_BOX_WIDTH - RUN_COUNT_GAP - textWidth(`✕  · ${RUN_LABEL}`, LINE_SIZE)

function failureWords(error: string | undefined): string {
  const said = (error ?? '').trim().split(NEWLINE)[0] ?? ''
  return said === '' ? 'failed' : oneLine(said, LINE_SIZE, FAILURE_ROOM)
}

/** Only the `run` line changes; a run's progress is not a node's identity. */
export function runEdits<E extends MaybeNodeElement>(
  scene: readonly E[],
  target: NodeTarget,
  status: NodeRunStatus,
): NodeEdit<E>[] {
  const edits: NodeEdit<E>[] = []
  for (const element of scene) {
    const data = nodeElementData(element, target)
    if (data?.role !== 'run') continue
    edits.push({ element, text: runLabel(status), keepRightEdge: true, data })
  }
  return edits
}
