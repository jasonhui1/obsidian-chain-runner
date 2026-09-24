import { buildDirectLabel, frameGeneratedName, frameRunId, reframe, relabel, rerunScene, selectedRunId } from './runLabel'
import { holdStamp } from './holdColumn'
import { embedNote, noteFrontmatter, save, selectedElements, type BoundDrawing } from './boundDrawing'
import type { SceneElement } from './excalidrawApi'
import { RUN_FRAME_GAP, uniqueRunFrameName, type FramedPanel, type RunFrame } from '../run/runFrame'

/** A run's frame on one drawing: its outputs, its Direct label, and where a rerun moves them. */

/** One output of a run: where it goes, and the note it shows. */
export interface PlacedOutput {
  placed: FramedPanel
  notePath: string
}

export interface RunFrames {
  /** `false` means no frame could be made and the outputs landed loose. */
  placeRun(frame: RunFrame, outputs: readonly PlacedOutput[]): Promise<boolean>
  /** Makes enlarged waiting frames leave room for the other runs of the same click. */
  stackRuns(runIds: readonly string[]): Promise<void>
}

export interface FollowRerun {
  /**
   * Moves the drawing on to a landed rerun: each card of the runs `from` to the
   * note `noteFor` files for its output, and the labels and frames to `to`.
   * `false` when the drawing shows none of `from`.
   */
  followRerun(
    from: readonly string[],
    to: string,
    noteFor: (output: string) => Promise<string | undefined>,
    toTitle: string,
  ): Promise<boolean>
}

/** Outputs the layout is about are drawn heavier. */
const EMPHASIS_STROKE = 4
const PLAIN_STROKE = 1

export class RunFrameDrawer implements RunFrames, FollowRerun {
  constructor(private readonly drawing: BoundDrawing) {}

  async placeRun(frame: RunFrame, outputs: readonly PlacedOutput[]): Promise<boolean> {
    const ea = this.drawing.emptied()
    const existing = ea.getViewElements().filter(element => element.type === 'frame' && element.name).map(element => element.name as string)
    frame.name = uniqueRunFrameName(frame.name, existing)

    // First, so the panels can name it as their container.
    const frameId = ea.addFrame?.(frame.box.x, frame.box.y, frame.box.width, frame.box.height, frame.name)
    const madeFrame = frameId ? ea.getElement(frameId) : undefined
    if (madeFrame) madeFrame.customData = reframe(madeFrame.customData, frame.runId, frame.name)

    for (const { placed, notePath } of outputs) {
      ea.style.strokeWidth = placed.emphasis ? EMPHASIS_STROKE : PLAIN_STROKE
      const element = embedNote(this.drawing.app, ea, placed.box, notePath)
      if (element) element.customData = { chainRunnerPanel: { runId: frame.runId, index: placed.index } }
      // A scripted element has to claim its frame; only a drop is worked out.
      if (element && frameId) element.frameId = frameId
    }
    ea.style.strokeWidth = PLAIN_STROKE

    const label = buildDirectLabel(frame.box, frame.runId)
    ea.style.strokeColor = label.strokeColor
    ea.style.fontSize = label.fontSize
    const made = ea.getElement(ea.addText(label.x, label.y, label.text, { textAlign: 'left' }))
    if (made) {
      made.link = label.link
      made.customData = label.customData
      if (frameId) made.frameId = frameId
    }
    // Not repositioned to the cursor: the coordinates are the node's own.
    await save(ea, false)
    return frameId !== undefined
  }

  async stackRuns(runIds: readonly string[]): Promise<void> {
    const scene = this.drawing.ea.getViewElements()
    const runs = new Set(runIds)
    const frames = scene.filter(element => element.type === 'frame' && runs.has(frameRunId(element) ?? ''))
      .sort((left, right) => (left.y ?? 0) - (right.y ?? 0))
    const shifts = new Map<string, number>()
    let bottom: number | undefined
    for (const frame of frames) {
      const y = frame.y ?? 0
      const shifted = bottom === undefined ? y : Math.max(y, bottom + RUN_FRAME_GAP)
      if (shifted !== y) shifts.set(frame.id, shifted - y)
      bottom = shifted + (frame.height ?? 0)
    }
    if (shifts.size === 0) return
    const moved = scene.filter(element => shifts.has(element.id) || (element.frameId && shifts.has(element.frameId)))
    const ea = this.drawing.emptied()
    ea.copyViewElementsToEAforEditing(moved)
    for (const element of moved) {
      const copy = ea.getElement(element.id)
      const shift = shifts.get(element.frameId ?? '') ?? shifts.get(element.id)
      if (copy && shift) copy.y = (copy.y ?? 0) + shift
    }
    await save(ea, false)
  }

  async followRerun(
    from: readonly string[],
    to: string,
    noteFor: (output: string) => Promise<string | undefined>,
    toTitle: string,
  ): Promise<boolean> {
    const scene = this.drawing.ea.getViewElements()
    const found = rerunScene(scene, from, toTitle, noteFrontmatter(this.drawing.app, this.drawing.view))
    if (!found) return false
    const renaming = new Set(found.frames.filter(frame => frame.name).map(frame => frame.element.id))
    const occupied = scene.filter(element => element.type === 'frame' && element.name && !renaming.has(element.id))
      .map(element => element.name as string)
    const notePaths = new Map<SceneElement, string>()
    for (const card of found.cards) {
      const notePath = await noteFor(card.output)
      if (notePath) notePaths.set(card.element, notePath)
    }

    const ea = this.drawing.emptied()
    ea.copyViewElementsToEAforEditing([...notePaths.keys(), ...found.labels, ...found.frames.map(frame => frame.element)])
    const copy = (element: SceneElement): SceneElement | undefined => ea.getElement(element.id)
    for (const [element, notePath] of notePaths) {
      const card = copy(element)
      if (card) card.link = `[[${notePath}]]`
    }
    for (const element of found.labels) {
      const label = copy(element)
      if (label) label.customData = relabel(label.customData, to)
    }
    for (const { element, name } of found.frames) {
      const frame = copy(element)
      if (frame) {
        const title = name ? uniqueRunFrameName(name, occupied, element.name ?? undefined) : undefined
        if (title) {
          frame.name = title
          occupied.push(title)
        }
        if (frameRunId(frame)) frame.customData = reframe(frame.customData, to, title ?? frameGeneratedName(frame))
      }
    }
    await save(ea, false)
    return true
  }

  /** The run the reader's selection belongs to: a hold's, a Direct label's, or a card's output note's. */
  selectedRun(): string | undefined {
    const selected = selectedElements(this.drawing.ea)
    return selected.map(element => holdStamp(element)?.runId).find(Boolean)
      ?? selectedRunId(selected, noteFrontmatter(this.drawing.app, this.drawing.view))
  }
}
