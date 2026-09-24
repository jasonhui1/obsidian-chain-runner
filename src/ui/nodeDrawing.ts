import {
  chainEdits,
  chainNodeData,
  nodeTargets,
  parameterEdits,
  reflowEdits,
  runCountEdits,
  runCountUpgrade,
  runEdits,
  type ChainNodeElement,
  type MaybeNodeElement,
  type NodeEdit,
  type NodeRunStatus,
  type NodeTarget,
} from './chainNode'
import { nodeBox, nodeRunCount, resolveInputs, type Box, type NodeInputs } from './nodeScene'
import { drawingPath, imageNoteLookup, save, selectedElements, type BoundDrawing } from './boundDrawing'
import type { ExcalidrawAutomate, SceneElement } from './excalidrawApi'
import type { ChainSummary } from '../engine/types'

/** Chain nodes on one drawing: placing them, re-shaping them, and the `▶ Run` line a run writes. */

/** What a node's drawing says about it, at the moment it was asked. */
export interface NodeReading {
  box: Box
  inputs: NodeInputs
  /** The editable field, defaulting to one on drawings not yet upgraded. */
  runCount?: string
  /** The drawing's path, which a wiki link on it resolves against. */
  drawing: string
}

/** Brings old nodes on the clicked drawing up to the current count control. */
export interface RunCountMigration {
  upgradeRunCounts(): Promise<boolean>
}

/** Placing chain nodes and re-shaping them, on one drawing. */
export interface NodeDrawing extends RunCountMigration {
  /** Puts a built node on the drawing, at the cursor, and saves. */
  place(elements: ChainNodeElement[]): Promise<void>
  /** Rewrites a node's parameter in place. `false` means the node is no longer there. */
  setParameter(target: NodeTarget, value: string): Promise<boolean>
  /** Rewrites a node's run count in place. `false` means the node is no longer there. */
  setRunCount(target: NodeTarget, count: number): Promise<boolean>
  /** Re-shapes a node around another chain. `false` means the node is no longer there. */
  setChain(target: NodeTarget, chain: ChainSummary, value?: string): Promise<boolean>
  /**
   * Cuts every resized node's lines to its new width. `false` when there was
   * nothing to do, which is every drawing the reader has not just dragged one on.
   */
  reflow(): Promise<boolean>
  /** The one node element the reader has selected, for the gestures the hook cannot see. */
  selectedNode(): MaybeNodeElement | undefined
}

/** A node as its run sees it. */
export interface NodeRun {
  /** What a node is bound to and where it sits; `undefined` when it is gone. */
  read(target: NodeTarget): NodeReading | undefined
  /** Rewrites the node's `▶ Run` line. `false` means the node is no longer there. */
  setRunStatus(target: NodeTarget, status: NodeRunStatus): Promise<boolean>
}

export class NodeDrawer implements NodeDrawing, NodeRun {
  constructor(private readonly drawing: BoundDrawing) {}

  async place(elements: ChainNodeElement[]): Promise<void> {
    const ea = this.drawing.emptied()
    const ids = elements.map(element => draw(ea, element))
    // One group, so the node's elements move, copy and delete together.
    if (ids.length > 1) ea.addToGroup(ids)
    // Reposition to the cursor.
    await save(ea, true)
  }

  setParameter(target: NodeTarget, value: string): Promise<boolean> {
    return write(this.drawing.emptied(), parameterEdits(this.drawing.ea.getViewElements(), target, value))
  }

  setRunCount(target: NodeTarget, count: number): Promise<boolean> {
    return write(this.drawing.emptied(), runCountEdits(this.drawing.ea.getViewElements(), target, count))
  }

  setChain(target: NodeTarget, chain: ChainSummary, value?: string): Promise<boolean> {
    const reshape = chainEdits(this.drawing.ea.getViewElements(), target, chain, value)
    return write(this.drawing.emptied(), reshape.edits, reshape.removals, reshape.additions)
  }

  reflow(): Promise<boolean> {
    const scene = this.drawing.ea.getViewElements()
    // Every node is asked; only one the reader dragged answers with anything.
    const edits = nodeTargets(scene).flatMap(target => reflowEdits(scene, target))
    return write(this.drawing.emptied(), edits)
  }

  async upgradeRunCounts(): Promise<boolean> {
    const scene = this.drawing.ea.getViewElements()
    let changed = false
    for (const target of nodeTargets(scene)) {
      const upgrade = runCountUpgrade(scene, target)
      if (await write(this.drawing.emptied(), upgrade.edits, upgrade.removals, upgrade.additions)) changed = true
    }
    return changed
  }

  selectedNode(): MaybeNodeElement | undefined {
    const selected = selectedElements(this.drawing.ea)
    // One element, so a double-click on a rubber-banded group runs nothing.
    const only = selected.length === 1 ? selected[0] : undefined
    return only && chainNodeData(only) ? only : undefined
  }

  read(target: NodeTarget): NodeReading | undefined {
    const scene = this.drawing.ea.getViewElements()
    const box = nodeBox(scene, target)
    if (!box) return undefined
    return {
      box,
      inputs: resolveInputs(scene, target, imageNoteLookup(this.drawing.ea)),
      runCount: nodeRunCount(scene, target) ?? '1',
      drawing: drawingPath(this.drawing.view),
    }
  }

  setRunStatus(target: NodeTarget, status: NodeRunStatus): Promise<boolean> {
    return write(this.drawing.emptied(), runEdits(this.drawing.ea.getViewElements(), target, status))
  }
}

/**
 * One change to a node on the scene, saved once. `false` means the node was
 * deleted between the click and the write. Not repositioned to the cursor: the
 * coordinates are the node's own.
 */
async function write(
  ea: ExcalidrawAutomate,
  edits: NodeEdit<SceneElement>[],
  removals: readonly SceneElement[] = [],
  additions: readonly ChainNodeElement[] = [],
): Promise<boolean> {
  if (edits.length === 0) return false

  // The copies keep their ids, so writing them back updates the node in place.
  ea.copyViewElementsToEAforEditing([...edits.map(edit => edit.element), ...removals])
  for (const edit of edits) {
    const element = ea.getElement(edit.element.id)
    if (!element) continue
    element.customData = { chainRunner: edit.data }
    if (edit.x !== undefined) element.x = edit.x
    if (edit.y !== undefined) element.y = edit.y
    if (edit.height !== undefined) element.height = edit.height
    if (edit.fontSize !== undefined) element.fontSize = edit.fontSize
    if (edit.width !== undefined) element.width = edit.width
    if (edit.text === undefined) continue
    const wasWide = element.width ?? 0
    // A text element holds its words in three places, and Excalidraw re-derives
    // from `rawText` when it saves and when it renders; set fewer and they snap back.
    element.text = edit.text
    element.originalText = edit.text
    element.rawText = edit.text
    ea.refreshTextElementSize?.(element.id)
    if (edit.keepRightEdge) element.x = (element.x ?? 0) + wasWide - (element.width ?? 0)
  }
  for (const element of removals) {
    const live = ea.getElement(element.id)
    if (live) live.isDeleted = true
  }
  // A line drawn now claims the node's group and frame; only a drop is worked out.
  const box = edits.find(edit => edit.data.role === 'box')?.element
  for (const element of additions) {
    const made = ea.getElement(draw(ea, element))
    if (!made) continue
    if (box?.groupIds) made.groupIds = [...box.groupIds]
    if (box?.frameId) made.frameId = box.frameId
  }
  await save(ea, false)
  return true
}

/** Adds one of the node's elements, and stamps it with what the node stores. */
function draw(ea: ExcalidrawAutomate, element: ChainNodeElement): string {
  ea.style.strokeColor = element.strokeColor
  // Set per element, not left to EA's default: the node's line heights are
  // computed from these sizes, so a line drawn at another one lands on its neighbour.
  if (element.fontSize) ea.style.fontSize = element.fontSize
  const id =
    element.shape === 'rect'
      ? drawRect(ea, element)
      : ea.addText(element.x, element.y, element.text ?? '', {
          width: element.width,
          textAlign: element.textAlign ?? 'left',
          // Dragging a node's handles must not rewrite its type size (ADR-0010).
          autoResize: false,
        })
  const made = ea.getElement(id)
  if (made) {
    // The link makes the line clickable; `customData` is what the click is
    // recognised by, and what survives a move, a copy and a reload.
    made.link = element.link ?? null
    made.customData = element.customData
  }
  return id
}

function drawRect(ea: ExcalidrawAutomate, element: ChainNodeElement): string {
  // Transparent, so a node sits over whatever the reader drew under it.
  ea.style.backgroundColor = 'transparent'
  return ea.addRect(element.x, element.y, element.width, element.height)
}
