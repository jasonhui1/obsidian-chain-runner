import { LINK_BLUE } from './ink'
import { linkpathOf, type Box, type SceneShape } from './nodeScene'
import { sourceRunId } from '../run/provenance'
import { FRAME_PADDING } from '../run/runFrame'

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
  const runId = sourceRunId(front)
  const proposal = (front as Record<string, unknown> | undefined)?.['output']
  return runId && typeof proposal === 'string' ? { runId, proposal } : undefined
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
