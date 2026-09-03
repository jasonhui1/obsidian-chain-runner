import { momentOf, parameterToAsk, type ChainSummary } from '../engine/types'

/**
 * What a chain node *is*, as pure shapes: one box holding the chain's name, its
 * moment, its dropdown and `▶ Run`. Five elements rather than one boxed text
 * because a click can only be caught on a link (`docs/spike-ea.md`, Q1), and a
 * link needs its own element. `src/ui/excalidraw.ts` puts them on a scene.
 */

/** Which part of the node an element is. Stored on it, so a click knows what was clicked. */
export type ChainNodeRole = 'box' | 'title' | 'moment' | 'parameter' | 'run'

/**
 * The node's identity, in each element's `customData`. Stamped on all five so a
 * reader who copies one line still gets something that knows its chain.
 */
export interface ChainNodeData {
  /** Ties the five elements together. Not an element id — those change on copy. */
  nodeId: string
  role: ChainNodeRole
  /** The chain's slug, which is what the engine is asked for again later. */
  chain: string
  /** The chain's name, so a node on a drawing reads without the engine. */
  chainName: string
  parameterName?: string
  parameterValue?: string
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
  textAlign?: 'left' | 'right'
  strokeColor: string
  /** The two lines a click means something on; absent everywhere else. */
  link?: string
  customData: { chainRunner: ChainNodeData }
}

/** Anything that might be a node's element: a scene element, or one just built. */
export interface MaybeNodeElement {
  customData?: unknown
  /** Excalidraw's own grouping. Re-made on copy, which is what separates two copies. */
  groupIds?: readonly string[]
}

/**
 * The links the two clickable lines carry. A scheme of our own, so a click that
 * escapes the hook fails as an unopenable link rather than creating a note.
 */
export const PARAMETER_LINK = 'chain-runner://parameter'
export const RUN_LINK = 'chain-runner://run'

/** Said in the dropdown line before anything has been picked. */
export const UNSET_PARAMETER = 'unset'

/** The key the node's identity lives under, inside Excalidraw's `customData`. */
const DATA_KEY = 'chainRunner'

/**
 * The node's measurements. Colours are Excalidraw's own palette, not Obsidian
 * CSS variables: a canvas element cannot read a variable, and the canvas inverts
 * in dark mode.
 */
const WIDTH = 300
const PADDING = 14
const LINE_GAP = 6
const TITLE_SIZE = 20
const LINE_SIZE = 16
/** Excalidraw's own line height for its hand-drawn font. */
const LINE_HEIGHT = 1.25
/** Excalidraw's font is not measurable here; this is the ratio its 20px glyphs average. */
const GLYPH_WIDTH = 0.58

const INK = '#1e1e1e'
const GREY = '#868e96'
const LINK_BLUE = '#1971c2'

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

/** The dropdown line: the parameter's name, the marker, and what it is set to. */
export function parameterLabel(name: string, value: string | undefined): string {
  return `${name} ${DROPDOWN_MARK} ${value || UNSET_PARAMETER}`
}

/**
 * The node's elements, top-left at the origin — the caller moves the set to the
 * cursor. The box comes first so every line sits on top of it.
 */
export function buildChainNode(chain: ChainSummary, options: ChainNodeOptions): ChainNodeElement[] {
  const parameter = parameterToAsk(chain)
  const data = (role: ChainNodeRole): { chainRunner: ChainNodeData } => ({
    chainRunner: {
      nodeId: options.nodeId,
      role,
      chain: chain.slug,
      chainName: chain.name,
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

  line('title', `${TITLE_MARK} ${chain.name}`, TITLE_SIZE, INK)
  const moment = momentOf(chain)
  if (moment) line('moment', `“${moment}”`, LINE_SIZE, GREY)
  if (parameter) {
    line('parameter', parameterLabel(parameter.name, options.parameterValue), LINE_SIZE, LINK_BLUE, PARAMETER_LINK)
  }

  // Run sits against the right edge, as the screen in #1 puts it.
  const runWidth = textWidth(RUN_LABEL, LINE_SIZE)
  const runHeight = Math.round(LINE_SIZE * LINE_HEIGHT)
  lines.push({
    role: 'run',
    shape: 'text',
    x: WIDTH - PADDING - runWidth,
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
  const { nodeId, role, chain, chainName, parameterName, parameterValue } = stamp as Record<string, unknown>
  if (typeof nodeId !== 'string' || typeof chain !== 'string' || typeof chainName !== 'string') return undefined
  if (!isRole(role)) return undefined
  return {
    nodeId,
    role,
    chain,
    chainName,
    ...(typeof parameterName === 'string' ? { parameterName } : {}),
    ...(typeof parameterValue === 'string' ? { parameterValue } : {}),
  }
}

function isRole(role: unknown): role is ChainNodeRole {
  return role === 'box' || role === 'title' || role === 'moment' || role === 'parameter' || role === 'run'
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
  /** The `run` line sits against the box's right edge; a grown label moves left. */
  keepRightEdge?: boolean
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
  if (status.kind === 'failed') return `✕ ${failureWords(status.error)} · ${RUN_LABEL}`
  return RUN_LABEL
}

const NEWLINE = '\n'

/**
 * What is left for the message beside the mark and `▶ Run` — about 19
 * characters. The full text is in the Notice and the run's notes (ADR-0003).
 */
const FAILURE_ROOM = WIDTH - PADDING * 2 - textWidth(`✕  · ${RUN_LABEL}`, LINE_SIZE)

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
