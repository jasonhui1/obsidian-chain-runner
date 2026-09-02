import { momentOf, parameterToAsk, type ChainSummary } from '../engine/types'

/**
 * What a chain node *is*, as a set of shapes — before anything Excalidraw knows
 * about it.
 *
 * The node is one box holding four lines: the chain's name, its moment in grey,
 * the one dropdown it may declare, and `▶ Run`. Two of those lines carry a link,
 * because a link is the only thing on an Excalidraw canvas a click can be caught
 * on (`docs/spike-ea.md`, Q1) — and a link needs an element of its own, so the
 * box is drawn as five elements rather than one boxed text.
 *
 * Everything here is a pure function of the chain, so the node's whole shape —
 * what it holds, where each line sits, what a rewritten parameter changes — is
 * checkable without a drawing. `src/ui/excalidraw.ts` is the only thing that
 * turns these into elements on a scene.
 */

/** Which part of the node an element is. Stored on it, so a click knows what was clicked. */
export type ChainNodeRole = 'box' | 'title' | 'moment' | 'parameter' | 'run'

/**
 * What every element of a node carries in its `customData`.
 *
 * This is the node's identity, and it is stamped on all five elements rather
 * than one: Excalidraw carries `customData` through moving, copying and a file
 * reload, and a reader who copies a single line of the box should get something
 * that still knows which chain it came from.
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
 * The links the two clickable lines carry.
 *
 * A scheme of our own, so that a node whose click is somehow not intercepted
 * fails as an unopenable link rather than as a note created in the vault. The
 * click is caught by `customData` rather than by matching these — the link's job
 * is only to make the line clickable at all.
 */
export const PARAMETER_LINK = 'chain-runner://parameter'
export const RUN_LINK = 'chain-runner://run'

/** Said in the dropdown line before anything has been picked. */
export const UNSET_PARAMETER = 'unset'

/** The key the node's identity lives under, inside Excalidraw's `customData`. */
const DATA_KEY = 'chainRunner'

/**
 * The node's measurements.
 *
 * Excalidraw's canvas inverts in dark mode, so these are its own palette values
 * and not Obsidian's CSS variables — a canvas element cannot read a variable,
 * and a colour picked to look right in one theme would be inverted into the
 * other. Grey for the moment, blue for the two links: the same two meanings the
 * result view gives `--text-muted` and `--text-accent`.
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
/** The marker that says the value can be changed, borrowed from the picker's own idiom. */
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
 * The node's elements, top-left at the origin.
 *
 * The box comes first so every line sits on top of it, and the caller moves the
 * whole set to where the reader's cursor is — which is why nothing here knows a
 * position on the drawing.
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
  // The situation the chain is for, in the chain's own words — the same line the
  // picker shows in grey, quoted the way the screen in #1 quotes it.
  const moment = momentOf(chain)
  if (moment) line('moment', `“${moment}”`, LINE_SIZE, GREY)
  if (parameter) {
    line('parameter', parameterLabel(parameter.name, options.parameterValue), LINE_SIZE, LINK_BLUE, PARAMETER_LINK)
  }

  // Run sits against the right edge rather than under the others: it is the one
  // line that does something, and the screen in #1 puts it there.
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
 * A line trimmed to what fits on one, with an ellipsis where it was cut.
 *
 * Excalidraw wraps text to the width it is given, and a wrapped line would push
 * the ones below it out through the bottom of the box — a chain with a long name
 * or a two-sentence moment would stop being one box. The box is a label rather
 * than the text itself: the chain's full name is a click away in the picker, and
 * the node has to stay the size the reader placed.
 *
 * The width is an estimate (`GLYPH_WIDTH`), so this is a guard against a runaway
 * line rather than a precise fit.
 */
function oneLine(text: string, fontSize: number, width: number): string {
  const fits = Math.floor(width / (fontSize * GLYPH_WIDTH))
  return text.length <= fits ? text : `${text.slice(0, Math.max(1, fits - 1)).trimEnd()}…`
}

/**
 * The node identity stamped on an element, or `undefined` when the element is
 * not part of a chain node.
 *
 * Every field is checked rather than assumed: `customData` survives a file
 * reload and a copy between vaults, so what comes back is whatever an older
 * version of this plugin — or another plugin entirely — happened to write.
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
 * Which node on the drawing an edit is aimed at.
 *
 * The id alone is not enough: copying a node copies its `customData` too, so two
 * copies of one node share an id. Excalidraw re-makes `groupIds` on copy, so the
 * group is what tells them apart — and an element the reader has ungrouped has
 * none, which is read as "still part of its node" rather than as a mismatch.
 */
export interface NodeTarget {
  nodeId: string
  groupIds?: readonly string[]
}

/** One element to write back, and what changes on it. */
export interface ParameterEdit<E> {
  element: E
  /** The new label, on the one line that shows the value; absent on the rest. */
  text?: string
  data: ChainNodeData
}

/**
 * What changes on a drawing when a node's parameter is set to `value`.
 *
 * Every element of the node is re-stamped, not just the line that shows the
 * value: the identity is carried on all five so that copying any one of them
 * keeps it, and a stale value on the other four would be a node that says one
 * thing and runs another the moment a reader copies the wrong line.
 */
export function parameterEdits<E extends MaybeNodeElement>(
  scene: readonly E[],
  target: NodeTarget,
  value: string,
): ParameterEdit<E>[] {
  const edits: ParameterEdit<E>[] = []
  for (const element of scene) {
    const data = chainNodeData(element)
    if (!data || data.nodeId !== target.nodeId) continue
    if (!sameNode(target, element)) continue
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

/** Whether an element belongs to the copy of the node that was clicked. */
function sameNode(target: NodeTarget, element: MaybeNodeElement): boolean {
  const theirs = element.groupIds ?? []
  const ours = target.groupIds ?? []
  if (theirs.length === 0 || ours.length === 0) return true
  return theirs.some(group => ours.includes(group))
}
