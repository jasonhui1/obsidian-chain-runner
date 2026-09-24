import type { MaybeNodeElement } from './chainNode'
import { buildDirectLabel, directLabelRunId, frameRunId, relabel } from './runLabel'
import {
  beforeHoldRow, buildHoldColumn, holdStamp, pickStamp, stampHold, stampPick, typedWords, waitingFrameBox,
  OWN_WORDS_PLACEHOLDER, PICK_COUNT, PICK_STEP, type HoldColumn, type HoldStamp, type OwnWordsCard,
} from './holdColumn'
import { boxOf, findHeld, pickRow, pickRowDrawn, roomBelow, rowHold, type HeldInRow, type PickRow } from './rowHold'
import { GREY, INK, LINK_BLUE } from './ink'
import { applyEdits, editCopies, embedNote, isElement, save, selectedElements, type BoundDrawing } from './boundDrawing'
import type { ExcalidrawAutomate, SceneElement } from './excalidrawApi'
import type { HoldRecord, LayoutPanel } from '../engine/types'
import { waitingRunFrameName, type RunFrame } from '../run/runFrame'
import type { RerunLanding } from '../run/rerunWatch'

/** A waiting hold's column on one drawing, and the pick rows its answers grow beside it. */

/** A run that stopped at a hold, drawn where its unreached cards were. */
export interface RunHold {
  /** Replaces only unreached cards in a newly started run with its waiting hold. */
  placeHold(frame: RunFrame, hold: HoldRecord, pending: readonly number[]): Promise<void>
}

/** A hold column's picks and rerolls, as their reruns land. */
export interface RerunHolds {
  /** Hold columns and pick rows already stored in this drawing. */
  pickSources(): { runId: string; nodeId: string; outputIndexes: number[]; placed: string[] }[]
  /** Adds the first in-place answer beside its candidate. */
  placePickRow(landing: RerunLanding, outputs: readonly { index: number; panel: LayoutPanel; notePath: string }[]): Promise<boolean>
  updatePickCounts(landing: RerunLanding): Promise<boolean>
  /** Draws the holds a pick row's run stopped at, at the end of its row; `false` when there is no row, or it already shows them. */
  placeRowHold(landing: RerunLanding, held: HeldInRow): Promise<boolean>
  /** Replaces a rerolled candidate set in its reserved column. */
  refreshHoldColumn(runId: string, nodeId: string, hold: HoldRecord): Promise<boolean>
}

export interface PickDrawing {
  selectedContinue(): MaybeNodeElement | undefined
  selectedReroll(): MaybeNodeElement | undefined
  /** What the reader typed on the hold's empty own-words card; `''` when nothing yet. */
  ownWords(runId: string, nodeId: string): string
}

export class HoldDrawer implements RunHold, RerunHolds, PickDrawing {
  constructor(
    private readonly drawing: BoundDrawing,
    private readonly canReroll: () => boolean,
  ) {}

  async placeHold(frame: RunFrame, hold: HoldRecord, pending: readonly number[]): Promise<void> {
    const scene = this.drawing.ea.getViewElements()
    const belonging = scene.find(element =>
      element.type === 'frame' && frameRunId(element) === frame.runId && element.x === frame.box.x && element.y === frame.box.y,
    )
    const pendingSet = new Set(pending)
    const unreached = scene.filter(element => {
      const panel = panelStamp(element)
      return panel?.runId === frame.runId && pendingSet.has(panel.index)
    })
    const directLabel = scene.find(element => directLabelRunId(element) === frame.runId && element.frameId === belonging?.id)
    const prior = scene.filter(element => {
      const stamp = holdStamp(element)
      return stamp?.runId === frame.runId && stamp.role === 'column'
    })
    const reached = beforeHoldRow(frame, pending)
    const reachedCards = scene.filter(element => {
      const panel = panelStamp(element)
      return panel?.runId === frame.runId && reached.some(placed => placed.index === panel.index)
    })
    const right = Math.max(
      frame.box.x + 8,
      ...reached.map(panel => panel.box.x + panel.box.width),
      ...prior.map(element => (element.x ?? 0) + (element.width ?? 0)),
    )
    const column = buildHoldColumn(hold, right + 24, frame.box.y + 32, { canReroll: this.canReroll() })
    const nextBox = waitingFrameBox(frame.box, reached.map(panel => panel.box), [
      column.box,
      ...prior.map(boxOf),
    ])
    const ea = this.drawing.emptied()
    if (belonging || unreached.length > 0 || directLabel || reachedCards.length > 0) {
      ea.copyViewElementsToEAforEditing([...(belonging ? [belonging] : []), ...unreached, ...reachedCards, ...(directLabel ? [directLabel] : [])])
      const actualFrame = belonging ? ea.getElement(belonging.id) : undefined
      if (actualFrame) {
        actualFrame.width = nextBox.width
        actualFrame.height = nextBox.height
        actualFrame.name = waitingRunFrameName(frame.name, frame.runId)
      }
      for (const card of unreached) {
        const copy = ea.getElement(card.id)
        if (copy) copy.isDeleted = true
      }
      for (const card of reachedCards) {
        const copy = ea.getElement(card.id)
        const panel = panelStamp(card)
        const placed = reached.find(one => one.index === panel?.index)
        if (copy && placed) {
          copy.x = placed.box.x
          copy.y = placed.box.y
        }
      }
      if (directLabel) {
        const copy = ea.getElement(directLabel.id)
        if (copy) {
          const next = buildDirectLabel(nextBox, frame.runId)
          copy.x = next.x
          copy.y = next.y
        }
      }
    }
    drawHoldColumn(ea, column, frame.runId, hold, belonging?.id, [...pending])
    await save(ea, false)
  }

  async refreshHoldColumn(runId: string, nodeId: string, hold: HoldRecord): Promise<boolean> {
    const scene = this.drawing.ea.getViewElements()
    const column = scene.find(element => {
      const stamp = holdStamp(element)
      return stamp?.role === 'column' && stamp.runId === runId && stamp.nodeId === nodeId && element.type === 'rectangle'
    })
    if (!column) return false
    if (!hold.candidates || hold.candidates.length === 0) return false
    const old = scene.filter(element => {
      const stamp = holdStamp(element)
      return stamp?.runId === runId && stamp.nodeId === nodeId
    })
    const next = buildHoldColumn(hold, column.x ?? 0, column.y ?? 0, { canReroll: this.canReroll() })
    const ea = this.drawing.emptied()
    applyEdits(ea, scene, roomBelow(scene, {
      frameId: column.frameId ?? undefined,
      from: (column.y ?? 0) + (column.height ?? 0),
      clear: next.box,
      stays: () => false,
    }, { removed: old.map(element => element.id), moved: new Map(), resized: new Map() }))
    drawHoldColumn(ea, next, runId, hold, column.frameId ?? undefined, holdStamp(column)?.outputIndexes)
    await save(ea, false)
    return true
  }

  selectedContinue(): MaybeNodeElement | undefined {
    return selectedHoldRole(this.drawing.ea, 'continue')
  }

  selectedReroll(): MaybeNodeElement | undefined {
    return selectedHoldRole(this.drawing.ea, 'reroll')
  }

  ownWords(runId: string, nodeId: string): string {
    const typed = findHeld(this.drawing.ea.getViewElements(), 'custom', runId, nodeId, (element, stamp) => element.type === 'text' && !stamp.heading)
    return typedWords(typed?.originalText ?? typed?.text ?? '')
  }

  pickSources(): { runId: string; nodeId: string; outputIndexes: number[]; placed: string[] }[] {
    const scene = this.drawing.ea.getViewElements()
    const placed = new Map<string, Set<string>>()
    for (const element of scene) {
      const stamp = pickStamp(element)
      if (!stamp) continue
      const runs = placed.get(stamp.nodeId) ?? new Set<string>()
      runs.add(stamp.runId)
      placed.set(stamp.nodeId, runs)
    }
    return scene.flatMap(element => {
      const stamp = holdStamp(element)
      return stamp?.role === 'column' && element.type === 'rectangle'
        ? [{ runId: stamp.runId, nodeId: stamp.nodeId, outputIndexes: stamp.outputIndexes ?? [],
          placed: [...(placed.get(stamp.nodeId) ?? [])] }]
        : []
    })
  }

  async placePickRow(landing: RerunLanding, outputs: readonly { index: number; panel: LayoutPanel; notePath: string }[]): Promise<boolean> {
    const pick = landing.pick
    if (!pick) return false
    const scene = this.drawing.ea.getViewElements()
    if (pickRowDrawn(scene, landing.runId, pick)) return true
    const plan = pickRow(scene, { runId: landing.runId, from: landing.from, pick, count: outputs.length })
    if (!plan) return false
    const { row, frameId } = plan
    const ea = this.drawing.emptied()
    const byId = new Map(scene.map(element => [element.id, element]))
    ea.copyViewElementsToEAforEditing(plan.touched.map(id => byId.get(id)).filter(isElement))
    editCopies(ea, plan)
    const chosen = ea.getElement(plan.candidate)
    if (chosen) chosen.strokeStyle = 'solid'
    if (plan.ownWords) useOwnWordsCard(ea, plan.candidate, plan.ownWords, pick.heading, frameId)
    const stamp = { runId: landing.runId, nodeId: pick.nodeId, heading: pick.heading, from: landing.from[0] ?? landing.runId }
    const mark = (element: SceneElement | undefined): void => {
      if (!element) return
      element.customData = { ...(typeof element.customData === 'object' && element.customData !== null ? element.customData : {}), ...stampPick(stamp) }
      if (frameId) element.frameId = frameId
    }
    ea.style.strokeColor = INK
    ea.style.strokeStyle = 'solid'
    ea.style.fontSize = 16
    mark(ea.getElement(ea.addText(row.tick.x, row.tick.y, '✓')))
    if (row.cards.length > 0) {
      ea.style.fontSize = 14
      mark(ea.getElement(ea.addText(row.heading.x, row.heading.y, pick.heading)))
      for (const [along, output] of outputs.entries()) {
        const { box, step, length } = row.cards[along]!
        const card = embedNote(this.drawing.app, ea, box, output.notePath)
        if (card) {
          card.customData = { ...stampPick(stamp), chainRunnerPanel: { runId: landing.runId, index: output.index } }
          if (frameId) card.frameId = frameId
        }
        const name = ea.getElement(ea.addText(step.x, step.y, output.panel.name))
        mark(name)
        if (name) name.customData = { ...(name.customData as Record<string, unknown>), [PICK_STEP]: output.index }
        const count = ea.getElement(ea.addText(length.x, length.y, `${output.panel.lines} lines`))
        mark(count)
        if (count) count.customData = { ...(count.customData as Record<string, unknown>), [PICK_COUNT]: output.index }
      }
      ea.style.strokeColor = LINK_BLUE
      const direct = ea.getElement(ea.addText(row.direct.x, row.direct.y, '✎ Direct'))
      if (direct) {
        direct.customData = { ...stampPick(stamp), ...relabel(direct.customData, landing.runId) }
        direct.link = 'chain-runner://direct'
        if (frameId) direct.frameId = frameId
      }
    }
    await save(ea, false)
    return true
  }

  async placeRowHold(landing: RerunLanding, held: HeldInRow): Promise<boolean> {
    const pick = landing.pick
    if (!pick) return false
    const scene = this.drawing.ea.getViewElements()
    const placed = rowHold(scene, {
      sourceRunId: landing.from[0] ?? landing.runId,
      runId: landing.runId,
      pick,
      held,
      canReroll: this.canReroll(),
    })
    if (!placed) return false
    const ea = this.drawing.emptied()
    applyEdits(ea, scene, placed)
    for (const { column, hold, pending } of placed.columns) drawHoldColumn(ea, column, landing.runId, hold, placed.frameId, pending)
    await save(ea, false)
    return true
  }

  async updatePickCounts(landing: RerunLanding): Promise<boolean> {
    const scene = this.drawing.ea.getViewElements()
    const changed = scene.filter(element => {
      const stamp = pickStamp(element)
      const index = (element.customData as Record<string, unknown> | undefined)?.[PICK_COUNT]
      return stamp?.runId === landing.runId && typeof index === 'number'
        && element.rawText !== `${landing.panels[index]?.lines ?? 0} lines`
    })
    if (changed.length === 0) return false
    const ea = this.drawing.emptied()
    ea.copyViewElementsToEAforEditing(changed)
    for (const element of changed) {
      const copy = ea.getElement(element.id)
      const index = (element.customData as Record<string, unknown>)[PICK_COUNT] as number
      if (!copy) continue
      const value = `${landing.panels[index]?.lines ?? 0} lines`
      copy.text = copy.originalText = copy.rawText = value
      ea.refreshTextElementSize?.(copy.id)
    }
    await save(ea, false)
    return true
  }
}

function drawOwnWordsCard(ea: ExcalidrawAutomate, card: OwnWordsCard, stamp: HoldStamp, frameId?: string): void {
  const { box, continueAt } = card
  ea.style.strokeColor = GREY
  ea.style.strokeStyle = 'dashed'
  const id = ea.addText(box.x, box.y, OWN_WORDS_PLACEHOLDER, {
    box: 'box', boxPadding: 12, width: box.width, textAlign: 'left',
  })
  const container = ea.getElement(id)
  const bound = ea.getElements().find(element => element.type === 'text' && element.containerId === id)
  for (const element of [container, bound]) {
    if (!element) continue
    element.customData = stampHold(stamp)
    element.link = 'chain-runner://hold'
    if (frameId) element.frameId = frameId
  }
  if (container) container.height = box.height
  if (bound) bound.text = bound.originalText = bound.rawText = OWN_WORDS_PLACEHOLDER
  ea.style.strokeColor = LINK_BLUE
  ea.style.strokeStyle = 'solid'
  const continueText = ea.getElement(ea.addText(continueAt.x, continueAt.y, '▶ Continue'))
  if (continueText) {
    continueText.customData = stampHold({ ...stamp, role: 'continue', custom: true })
    if (frameId) continueText.frameId = frameId
  }
}

function drawHoldColumn(ea: ExcalidrawAutomate, column: HoldColumn, runId: string, hold: HoldRecord, frameId?: string, outputIndexes?: number[]): void {
  const columnStamp: HoldStamp = { runId, nodeId: hold.nodeId, heading: '', revision: hold.revision, outputIndexes, role: 'column' }
  ea.style.strokeColor = INK
  const outline = ea.getElement(ea.addRect(column.box.x, column.box.y, column.box.width, column.box.height))
  if (outline) {
    outline.customData = stampHold(columnStamp)
    if (frameId) outline.frameId = frameId
  }
  ea.style.fontSize = 16
  const prompt = ea.getElement(ea.addText(column.prompt.box.x, column.prompt.box.y, column.prompt.text, {
    width: column.prompt.box.width, autoResize: false,
  }))
  if (prompt) {
    prompt.customData = stampHold(columnStamp)
    if (frameId) prompt.frameId = frameId
  }
  for (const candidate of column.candidates) {
    const stamp: HoldStamp = { ...columnStamp, heading: candidate.heading, role: 'candidate' }
    ea.style.strokeColor = GREY
    ea.style.strokeStyle = 'dashed'
    const id = ea.addText(candidate.box.x, candidate.box.y, candidate.text, {
      box: 'box', boxPadding: 12, width: candidate.box.width, textAlign: 'left',
    })
    const container = ea.getElement(id)
    const bound = ea.getElements().find(element => element.type === 'text' && element.containerId === id)
    for (const element of [container, bound]) {
      if (!element) continue
      element.customData = stampHold(stamp)
      element.link = 'chain-runner://hold'
      if (frameId) element.frameId = frameId
    }
    if (container) container.height = candidate.box.height - 36
    if (bound) bound.text = bound.originalText = bound.rawText = candidate.text
    ea.style.strokeColor = LINK_BLUE
    ea.style.strokeStyle = 'solid'
    const continueText = ea.getElement(ea.addText(candidate.continueAt.x, candidate.continueAt.y, '▶ Continue'))
    if (continueText) {
      continueText.customData = stampHold({ ...stamp, role: 'continue' })
      if (frameId) continueText.frameId = frameId
    }
  }
  drawOwnWordsCard(ea, column.ownWords, { ...columnStamp, role: 'custom' }, frameId)
  if (column.rerollAt) {
    ea.style.strokeColor = LINK_BLUE
    ea.style.strokeStyle = 'solid'
    const rerollText = ea.getElement(ea.addText(column.rerollAt.x, column.rerollAt.y, '⟳ Reroll'))
    if (rerollText) {
      rerollText.customData = stampHold({ ...columnStamp, role: 'reroll' })
      if (frameId) rerollText.frameId = frameId
    }
  }
}

/** A used own-words card keeps the words it ran with; a fresh empty card waits below it and its row. */
function useOwnWordsCard(
  ea: ExcalidrawAutomate,
  cardId: string,
  used: NonNullable<PickRow['ownWords']>,
  heading: string,
  frameId: string | undefined,
): void {
  const card = ea.getElement(cardId)
  const stamp = card && holdStamp(card)
  if (!card || !stamp) return
  card.customData = stampHold({ ...stamp, heading })
  const words = used.wordsId === undefined ? undefined : ea.getElement(used.wordsId)
  if (words) {
    words.customData = stampHold({ ...stamp, heading })
    if (used.text !== undefined) {
      words.text = words.originalText = words.rawText = used.text
      ea.refreshTextElementSize?.(words.id)
    }
  }
  drawOwnWordsCard(ea, used.next, { ...stamp, heading: '' }, frameId)
}

function selectedHoldRole(ea: ExcalidrawAutomate, role: HoldStamp['role']): MaybeNodeElement | undefined {
  const selected = selectedElements(ea)
  const only = selected.length === 1 ? selected[0] : undefined
  return only && holdStamp(only)?.role === role ? only : undefined
}

function panelStamp(element: SceneElement): { runId: string; index: number } | undefined {
  const data = element.customData
  if (!data || typeof data !== 'object') return undefined
  const stamp = (data as Record<string, unknown>).chainRunnerPanel
  if (!stamp || typeof stamp !== 'object') return undefined
  const { runId, index } = stamp as Record<string, unknown>
  return typeof runId === 'string' && typeof index === 'number' ? { runId, index } : undefined
}
