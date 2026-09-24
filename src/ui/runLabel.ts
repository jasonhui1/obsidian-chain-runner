import { LINK_BLUE } from './ink'
import { linkpathOf, type Box, type SceneShape } from './nodeScene'
import { sourceNote } from '../run/provenance'
import { FRAME_PADDING, renameRunFrame } from '../run/runFrame'

/**
 * The `✎ Direct` label on a run's frame, and which run a selection on the
 * drawing belongs to. Pure; `src/ui/excalidraw.ts` puts the label on a scene.
 */

/** A scheme of our own, so a click that escapes the hook fails as an unopenable link. */
export const DIRECT_LINK = 'chain-runner://direct'

/** Under its own key, so a node's or a proposal's stamp is never read as this one. */
const DATA_KEY = 'chainRunnerRun'

const LABEL = '✎ Direct'
const LABEL_SIZE = 16
const LINE_HEIGHT = 1.25
/** Excalidraw's font is not measurable here; this is the ratio its glyphs average. */
const GLYPH_WIDTH = 0.58

export interface DirectLabelElement {
  x: number
  y: number
  width: number
  height: number
  text: string
  fontSize: number
  strokeColor: string
  link: string
  customData: { chainRunnerRun: { runId: string } }
}

/** In the frame's top-right corner, inside the padding above its panels. */
export function buildDirectLabel(frame: Box, runId: string): DirectLabelElement {
  const width = Math.round(LABEL.length * LABEL_SIZE * GLYPH_WIDTH)
  const height = Math.round(LABEL_SIZE * LINE_HEIGHT)
  return {
    x: frame.x + frame.width - FRAME_PADDING - width,
    y: frame.y + Math.round((FRAME_PADDING - height) / 2),
    width,
    height,
    text: LABEL,
    fontSize: LABEL_SIZE,
    strokeColor: LINK_BLUE,
    link: DIRECT_LINK,
    customData: { [DATA_KEY]: { runId } } as DirectLabelElement['customData'],
  }
}

/** The run a Direct label directs, or `undefined` for any other element. */
export function directLabelRunId(element: { customData?: unknown }): string | undefined {
  const custom = element.customData
  if (typeof custom !== 'object' || custom === null) return undefined
  const stamp = (custom as Record<string, unknown>)[DATA_KEY]
  if (typeof stamp !== 'object' || stamp === null) return undefined
  const runId = (stamp as Record<string, unknown>)['runId']
  return typeof runId === 'string' ? runId : undefined
}

/** A card's output note's frontmatter, by the link the card shows it through. */
export type NoteFrontmatter = (linkpath: string) => unknown

/** A card on the drawing, as the output note it shows records it. */
export interface CardProposal {
  runId: string
  proposal: string
}

/** The run and proposal a card's output note records, or `undefined` for anything but such a card. */
export function cardProposal(element: SceneShape, frontmatter: NoteFrontmatter): CardProposal | undefined {
  if (element.type !== 'embeddable' && element.type !== 'iframe') return undefined
  const linkpath = linkpathOf(element.link)
  const front = linkpath ? frontmatter(linkpath) : undefined
  const note = sourceNote(front)
  return note && { runId: note.runId, proposal: note.output }
}

/**
 * The run a selection belongs to: a Direct label's, or the run a card's output
 * note records — which is how a run drawn before the label existed is reached.
 */
export function selectedRunId(selected: readonly SceneShape[], frontmatter: NoteFrontmatter): string | undefined {
  for (const element of selected) {
    const run = directLabelRunId(element) ?? cardProposal(element, frontmatter)?.runId
    if (run) return run
  }
  return undefined
}

/** A label directing `runId`, keeping whatever else the element carries. */
export function relabel(custom: unknown, runId: string): Record<string, unknown> {
  const rest = typeof custom === 'object' && custom !== null ? (custom as Record<string, unknown>) : {}
  return { ...rest, [DATA_KEY]: { runId } }
}

export function frameRunId(element: { customData?: unknown }): string | undefined {
  const custom = element.customData
  if (!custom || typeof custom !== 'object') return undefined
  const stamp = (custom as Record<string, unknown>).chainRunnerFrame
  if (!stamp || typeof stamp !== 'object') return undefined
  const runId = (stamp as Record<string, unknown>).runId
  return typeof runId === 'string' ? runId : undefined
}

export function frameGeneratedName(element: { customData?: unknown }): string | undefined {
  const custom = element.customData
  if (!custom || typeof custom !== 'object') return undefined
  const stamp = (custom as Record<string, unknown>).chainRunnerFrame
  if (!stamp || typeof stamp !== 'object') return undefined
  const name = (stamp as Record<string, unknown>).name
  return typeof name === 'string' ? name : undefined
}

export function reframe(custom: unknown, runId: string, name?: string): Record<string, unknown> {
  const rest = typeof custom === 'object' && custom !== null ? (custom as Record<string, unknown>) : {}
  return { ...rest, chainRunnerFrame: { runId, ...(name ? { name } : {}) } }
}

/** An element as a rerun's landing reads it: a frame has a name, and anything may sit in one. */
export interface FramedShape extends SceneShape {
  frameId?: string | null
  name?: string | null
}

/** What a landed rerun moves on, on one drawing: each card by the output it shows, the labels, and their frames' new names. */
export interface RerunScene<E> {
  cards: { element: E; output: string }[]
  labels: E[]
  frames: { element: E; name?: string }[]
}

/**
 * What on a drawing shows any of `from` — the runs a hold was under — for a
 * rerun that landed as `to`; `undefined` when nothing does.
 */
export function rerunScene<E extends FramedShape>(
  scene: readonly E[],
  from: readonly string[],
  toTitle: string,
  frontmatter: NoteFrontmatter,
): RerunScene<E> | undefined {
  const fromRuns = (runId: string | undefined): boolean => runId !== undefined && from.includes(runId)
  const cards = scene.flatMap(element => {
    const card = cardProposal(element, frontmatter)
    return card && fromRuns(card.runId) ? [{ element, output: card.proposal }] : []
  })
  const labels = scene.filter(element => fromRuns(directLabelRunId(element)))
  const framed = new Set([...cards.map(card => card.element), ...labels].map(element => element.frameId))
  const frames = scene.flatMap(element => {
    if (element.type !== 'frame' || (!framed.has(element.id) && !fromRuns(frameRunId(element)))) return []
    const name = element.name && renameRunFrame(element.name, {
      fromRunIds: from, toTitle, stampedRunId: frameRunId(element), generatedName: frameGeneratedName(element),
    })
    return name || fromRuns(frameRunId(element)) ? [{ element, ...(name ? { name } : {}) }] : []
  })
  if (cards.length === 0 && labels.length === 0 && frames.length === 0) return undefined
  return { cards, labels, frames }
}
