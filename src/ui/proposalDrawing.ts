import { chainNodeData } from './chainNode'
import { blockInput, type Box, type NodeInput } from './nodeScene'
import {
  ACCEPTED_STROKE,
  ACCEPTED_STROKE_STYLE,
  PROPOSAL_STROKE,
  PROPOSAL_STROKE_STYLE,
  acceptEdits,
  buildProposalLabels,
  dismissEdits,
  proposalData,
  type ProposalData,
  type ProposalEdits,
  type ProposalIdentity,
  type ProposalRole,
} from './proposal'
import { drawingPath, embedNote, imageNoteLookup, save, selectedElements, type BoundDrawing } from './boundDrawing'
import type { SceneElement } from './excalidrawApi'

/** One block the reader picked out to expand: what it says, and where it sits. */
export interface BlockReading {
  /** The element itself, which a proposal's connector binds back to. */
  id: string
  box: Box
  input: NodeInput
  /** The drawing's path, which a wiki link on it resolves against. */
  drawing: string
}

/** One proposal to draw: the note behind it, where it goes, and what marks it as one. */
export interface PlacedProposal {
  box: Box
  notePath: string
  identity: ProposalIdentity
}

/** Placing a block's proposals on one drawing, and keeping or dropping them. */
export interface ProposalDrawing {
  /** The one block the reader has selected, or `undefined` when it is not one we can read. */
  selection(): BlockReading | undefined
  /** Draws a run's proposals greyed and dashed, each connected back to `source`. */
  placeProposals(proposals: readonly PlacedProposal[], source: BlockReading): Promise<void>
  /** The proposal the reader has selected, for the commands that decide one. */
  selectedProposal(): ProposalData | undefined
  /** Keeps or drops a proposal. `false` means it is no longer on the drawing. */
  editProposal(proposalId: string, action: 'accept' | 'dismiss'): Promise<boolean>
}

export class ProposalDrawer implements ProposalDrawing {
  constructor(private readonly drawing: BoundDrawing) {}

  selection(): BlockReading | undefined {
    const { ea, view } = this.drawing
    const selected = selectedElements(ea)
    if (selected.length !== 1) return undefined
    const element = selected[0]
    // Our own furniture is not material to expand: a node, or another proposal.
    if (!element || chainNodeData(element) || proposalData(element)) return undefined
    const input = blockInput(element, ea.getViewElements(), imageNoteLookup(ea))
    if (!input) return undefined
    return {
      id: element.id,
      box: {
        x: element.x ?? 0,
        y: element.y ?? 0,
        width: element.width ?? 0,
        height: element.height ?? 0,
      },
      input,
      drawing: drawingPath(view),
    }
  }

  async placeProposals(proposals: readonly PlacedProposal[], source: BlockReading): Promise<void> {
    const ea = this.drawing.emptied()
    /** Marks a drawn element as this proposal's, and greys it. */
    const mark = (id: string | undefined, identity: ProposalIdentity, role: ProposalRole): void => {
      const element = id ? ea.getElement(id) : undefined
      if (!element) return
      element.strokeColor = PROPOSAL_STROKE
      element.strokeStyle = PROPOSAL_STROKE_STYLE
      element.customData = { chainRunnerProposal: { ...identity, role } }
      ids.push(element.id)
    }

    let ids: string[] = []
    for (const { box, notePath, identity } of proposals) {
      ea.style.strokeColor = PROPOSAL_STROKE
      ea.style.strokeStyle = PROPOSAL_STROKE_STYLE
      ids = []

      const card = embedNote(this.drawing.app, ea, box, notePath)
      mark(card?.id, identity, 'card')

      // The connector is what makes a card read as this block's proposal. Drawn
      // from the source's own edge: a stub short of it points at nothing.
      mark(
        ea.addArrow?.(
          [
            [source.box.x + source.box.width, source.box.y + source.box.height / 2],
            [box.x, box.y + box.height / 2],
          ],
          { startObjectId: source.id, ...(card ? { endObjectId: card.id } : {}) },
        ),
        identity,
        'link',
      )

      for (const label of buildProposalLabels(box, identity)) {
        ea.style.strokeColor = label.strokeColor
        ea.style.strokeStyle = ACCEPTED_STROKE_STYLE
        ea.style.fontSize = label.fontSize
        const made = ea.getElement(ea.addText(label.x, label.y, label.text, { textAlign: 'left' }))
        if (!made) continue
        made.link = label.link
        made.customData = label.customData
        ids.push(made.id)
      }
      // One group, so a proposal's card, connector and labels move together.
      if (ids.length > 1) ea.addToGroup(ids)
    }
    // Not repositioned to the cursor: the coordinates are the source block's own.
    await save(ea, false)
  }

  selectedProposal(): ProposalData | undefined {
    for (const element of selectedElements(this.drawing.ea)) {
      const data = proposalData(element)
      if (data) return data
    }
    return undefined
  }

  async editProposal(proposalId: string, action: 'accept' | 'dismiss'): Promise<boolean> {
    const scene = this.drawing.ea.getViewElements()
    const edits: ProposalEdits<SceneElement> =
      action === 'accept' ? acceptEdits(scene, proposalId) : dismissEdits(scene, proposalId)
    const touched = [...edits.normalise, ...edits.remove]
    if (touched.length === 0) return false

    const ea = this.drawing.emptied()
    // The copies keep their ids, so writing them back edits the drawing in place.
    ea.copyViewElementsToEAforEditing(touched)
    for (const element of edits.normalise) {
      const live = ea.getElement(element.id)
      if (!live) continue
      live.strokeColor = ACCEPTED_STROKE
      live.strokeStyle = ACCEPTED_STROKE_STYLE
      // Only our own key: another plugin's stamp on the same element is not ours to drop.
      live.customData = withoutProposal(live.customData)
    }
    for (const element of edits.remove) {
      const live = ea.getElement(element.id)
      if (live) live.isDeleted = true
    }
    await save(ea, false)
    return true
  }
}

/** An accepted proposal is ordinary material: nothing left saying it was one. */
function withoutProposal(custom: unknown): unknown {
  if (typeof custom !== 'object' || custom === null) return custom
  const rest = { ...(custom as Record<string, unknown>) }
  delete rest['chainRunnerProposal']
  return Object.keys(rest).length === 0 ? undefined : rest
}
