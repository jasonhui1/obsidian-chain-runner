import { GREY, INK, LINK_BLUE } from './ink'
import type { Box } from './nodeScene'

/**
 * What a proposal *is*, as pure shapes: a card showing an output note, drawn
 * grey and dashed until the reader keeps it, and the two labels that keep or
 * drop it. `src/ui/excalidraw.ts` puts them on a scene.
 */

/** Which part of a proposal an element is. Stored on it, so a click knows what was clicked. */
export type ProposalRole = 'card' | 'link' | 'accept' | 'dismiss'

/**
 * A proposal's identity, in each element's `customData`. Under its own key, so a
 * chain node's stamp and a proposal's are never read for one another.
 */
export interface ProposalData {
  /** Ties one proposal's elements together; dismissing it leaves its siblings. */
  proposalId: string
  role: ProposalRole
  chainName: string
  runId: string
  /** The note the card shows. A dismissal deletes it. */
  notePath: string
}

/** A proposal's identity without the part that differs per element. */
export type ProposalIdentity = Omit<ProposalData, 'role'>

/** Anything that might be a proposal's element: a scene element, or one just built. */
export interface MaybeProposalElement {
  customData?: unknown
}

/**
 * The links the two labels carry. A scheme of our own, so a click that escapes
 * the hook fails as an unopenable link rather than creating a note.
 */
export const ACCEPT_LINK = 'chain-runner://accept'
export const DISMISS_LINK = 'chain-runner://dismiss'

/** The key a proposal's identity lives under, inside Excalidraw's `customData`. */
const DATA_KEY = 'chainRunnerProposal'

/** Grey and dashed while it is a proposal; the drawing's own ink once it is kept. */
export const PROPOSAL_STROKE = GREY
export const PROPOSAL_STROKE_STYLE = 'dashed'
export const ACCEPTED_STROKE = INK
export const ACCEPTED_STROKE_STYLE = 'solid'

const ACCEPT_LABEL = '✓ Keep'
const DISMISS_LABEL = '✕ Drop'

const LABEL_SIZE = 16
const LINE_HEIGHT = 1.25
/** Excalidraw's font is not measurable here; this is the ratio its glyphs average. */
const GLYPH_WIDTH = 0.58
/** Between the card's bottom edge and the labels under it. */
const LABEL_GAP = 10
const LABEL_SPACING = 24

/**
 * How far below a card its labels reach. What places the cards has to leave at
 * least this much under each one, or a card's labels land on its neighbour.
 */
export const LABEL_ROOM = LABEL_GAP + Math.round(LABEL_SIZE * LINE_HEIGHT)

/** One of the two labels under a card, in the shapes Excalidraw is later asked for. */
export interface ProposalLabelElement {
  role: 'accept' | 'dismiss'
  x: number
  y: number
  width: number
  height: number
  text: string
  fontSize: number
  strokeColor: string
  link: string
  customData: { chainRunnerProposal: ProposalData }
}

/**
 * The `✓ Keep` / `✕ Drop` pair under a card. Two elements rather than one,
 * because a click can only be caught on a link (`docs/spike-ea.md`, Q1).
 */
export function buildProposalLabels(card: Box, identity: ProposalIdentity): ProposalLabelElement[] {
  const height = Math.round(LABEL_SIZE * LINE_HEIGHT)
  const y = card.y + card.height + LABEL_GAP
  let x = card.x

  return ([
    ['accept', ACCEPT_LABEL, LINK_BLUE, ACCEPT_LINK],
    ['dismiss', DISMISS_LABEL, GREY, DISMISS_LINK],
  ] as const).map(([role, text, strokeColor, link]) => {
    const width = textWidth(text)
    const label: ProposalLabelElement = {
      role,
      x,
      y,
      width,
      height,
      text,
      fontSize: LABEL_SIZE,
      strokeColor,
      link,
      customData: { chainRunnerProposal: { ...identity, role } },
    }
    x += width + LABEL_SPACING
    return label
  })
}

function textWidth(text: string): number {
  return Math.round(text.length * LABEL_SIZE * GLYPH_WIDTH)
}

/**
 * The proposal identity stamped on an element, or `undefined` when it is not a
 * proposal's. Every field is checked: `customData` may be whatever an older
 * version of this plugin, or another plugin, wrote.
 */
export function proposalData(element: MaybeProposalElement): ProposalData | undefined {
  const custom = element.customData
  if (typeof custom !== 'object' || custom === null) return undefined
  const stamp = (custom as Record<string, unknown>)[DATA_KEY]
  if (typeof stamp !== 'object' || stamp === null) return undefined
  const { proposalId, role, chainName, runId, notePath } = stamp as Record<string, unknown>
  if (typeof proposalId !== 'string' || typeof chainName !== 'string') return undefined
  if (typeof runId !== 'string' || typeof notePath !== 'string') return undefined
  if (!isRole(role)) return undefined
  return { proposalId, role, chainName, runId, notePath }
}

function isRole(role: unknown): role is ProposalRole {
  return role === 'card' || role === 'link' || role === 'accept' || role === 'dismiss'
}

/** What changes on a drawing when a proposal is kept or dropped. */
export interface ProposalEdits<E> {
  /** Elements that stay, redrawn as ordinary material. */
  normalise: E[]
  /** Elements that go off the drawing. */
  remove: E[]
}

/**
 * Keeping a proposal: the card and its connector become ordinary material, and
 * the labels go — there is nothing left to decide once it has been decided.
 */
export function acceptEdits<E extends MaybeProposalElement>(
  scene: readonly E[],
  proposalId: string,
): ProposalEdits<E> {
  const edits: ProposalEdits<E> = { normalise: [], remove: [] }
  for (const element of scene) {
    const data = proposalData(element)
    if (data?.proposalId !== proposalId) continue
    if (data.role === 'card' || data.role === 'link') edits.normalise.push(element)
    else edits.remove.push(element)
  }
  return edits
}

/** Dropping a proposal: all of it goes. The note behind it is the caller's to delete. */
export function dismissEdits<E extends MaybeProposalElement>(
  scene: readonly E[],
  proposalId: string,
): ProposalEdits<E> {
  return {
    normalise: [],
    remove: scene.filter(element => proposalData(element)?.proposalId === proposalId),
  }
}
