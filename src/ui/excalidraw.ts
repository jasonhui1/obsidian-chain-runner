import { TFile, normalizePath, type App, type FileView, type WorkspaceLeaf } from 'obsidian'
import { drawingChoices, isDrawingPath, type DrawingChoice } from './drawingChoices'
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
import {
  blockInput,
  nodeBox,
  nodeRunCount,
  resolveInputs,
  type Box,
  type ImageNoteLookup,
  type NodeInput,
  type NodeInputs,
  type SceneShape,
} from './nodeScene'
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
import { buildDirectLabel, cardProposal, directLabelRunId, frameRunId, reframe, relabel, rerunScene, selectedRunId, type CardProposal, type NoteFrontmatter } from './runLabel'
import { beforeHoldRow, buildHoldColumn, buildPickRow, holdStamp, pickStamp, stampHold, stampPick, waitingFrameBox, type HoldColumn, type HoldStamp } from './holdColumn'
import { GREY, INK, LINK_BLUE } from './ink'
import { SelectionClicks, type SelectedIds } from './selectionClick'
import { DEFAULT_SCRIPT_FOLDER, type ScriptVault } from './toolScript'
import type { ChainSummary, HoldRecord } from '../engine/types'
import { RUN_FRAME_GAP, waitingRunFrameName, type FramedPanel, type RunFrame } from '../run/runFrame'
import type { RerunLanding } from '../run/rerunWatch'
import type { LayoutPanel } from '../engine/types'

/**
 * The Excalidraw plugin, as this plugin reaches it (`docs/spike-ea.md`). What is
 * *drawn* is decided by `./drawingChoices` and the caller, not here.
 */

const PLUGIN_ID = 'obsidian-excalidraw-plugin'

/** The view type Excalidraw registers. A drawing open as markdown is not one. */
const EXCALIDRAW_VIEW = 'excalidraw'

/** Every call below predates 2.0; verified against 2.26.4 (`docs/spike-ea.md`). */
const MINIMUM_VERSION = '2.0.0'

/** The embeddable's starting size; the reader resizes it afterwards. */
const EMBEDDABLE_WIDTH = 400
const EMBEDDABLE_HEIGHT = 300

/** How long to wait for a drawing opened just now to become an Excalidraw view. */
const VIEW_READY_TIMEOUT_MS = 3000
const VIEW_READY_POLL_MS = 50

/**
 * The slice of ExcalidrawAutomate this plugin calls. Typed rather than imported:
 * an import would make an optional plugin a build dependency.
 */
interface ExcalidrawAutomate {
  verifyMinimumPluginVersion(version: string): boolean
  /** A fresh instance bound to `view`, which no other caller's `setView` can move. */
  getAPI(view: DrawingView): ExcalidrawAutomate
  /** Empties the workbench and puts the style back; the view stays bound. */
  reset(): void
  style: ElementStyle
  addEmbeddable(x: number, y: number, width: number, height: number, url?: string, file?: TFile): string
  addRect(x: number, y: number, width: number, height: number): string
  /** Feature-detected: the spike verified the other `add*` calls, not this one. */
  addArrow?(points: [number, number][], formatting?: ArrowFormatting): string
  /** Feature-detected: the spike verified the other `add*` calls, not this one. */
  addFrame?(x: number, y: number, width: number, height: number, name?: string): string
  addText(x: number, y: number, text: string, formatting?: TextFormatting): string
  getElements(): SceneElement[]
  getElement(id: string): SceneElement | undefined
  getViewElements(): SceneElement[]
  /** What the reader has selected. Feature-detected, like `addFrame`. */
  getViewSelectedElements?(): SceneElement[]
  /** The note behind an image element — how a file inserted from the vault is drawn. */
  getViewFileForImageElement?(element: SceneElement): TFile | null
  /** Puts existing scene elements on the workbench, ids kept, so a write updates them. */
  copyViewElementsToEAforEditing(elements: SceneElement[]): void
  addToGroup(elementIds: string[]): string
  /** Re-measures a text element after its text changed; a no-op on older builds. */
  refreshTextElementSize?(id: string): void
  addElementsToView(repositionToCursor?: boolean, save?: boolean): Promise<boolean>
  onLinkClickHook?: LinkClickHook
  onSceneChangeHook?: SceneChangeHook | null
}

/** EA's element defaults, set before each `add*` call rather than passed to it. */
interface ElementStyle {
  strokeColor: string
  backgroundColor: string
  strokeWidth: number
  strokeStyle: StrokeStyle
  fontSize: number
  textAlign: string
}

/** Excalidraw's three stroke styles; a proposal is drawn in the dashed one. */
type StrokeStyle = 'solid' | 'dashed' | 'dotted'

interface ArrowFormatting {
  startObjectId?: string
  endObjectId?: string
}

interface TextFormatting {
  box?: 'box'
  boxPadding?: number
  width?: number
  textAlign?: string
  /** Off with a width given, a text element wraps on resize instead of scaling (ADR-0010). */
  autoResize?: boolean
}

/** An element on the scene, narrowed to the fields a chain node reads or writes. */
interface SceneElement extends SceneShape {
  /** The frame this element belongs to. Excalidraw assigns it on drop; we assign it on place. */
  frameId?: string | null
  strokeColor?: string
  strokeStyle?: StrokeStyle
  /** Excalidraw's own tombstone; setting it is how a scripted element is removed. */
  isDeleted?: boolean
  /** The words as Excalidraw saves and re-parses them; the third place a text element holds them. */
  rawText?: string
  /** A frame's title. */
  name?: string | null
  /** A drag scales this; a re-cut puts it back to the size the node was designed at. */
  fontSize?: number
}

/** EA's link-click hook; returning `false` stops the link opening (`docs/spike-ea.md`, Q1). */
type LinkClickHook = (
  element: SceneElement,
  linkText: string,
  event: unknown,
  view: DrawingView,
  ea: unknown,
) => boolean

/**
 * EA's scene-change hook. An object, not a function, and it only fires for the
 * `appStateKeys` it names — without one it is never called at all.
 */
interface SceneChangeHook {
  appStateKeys?: string[]
  trackElements?: boolean
  triggerWhenInvisible?: boolean
  callback: (
    elements: SceneElement[],
    appState: SceneAppState | undefined,
    files: unknown,
    view: DrawingView,
    ea: unknown,
  ) => void
}

/** The slice of Excalidraw's app state the selection hook reads. */
interface SceneAppState {
  selectedElementIds?: SelectedIds
  /** The text element being typed into. Excalidraw opens its editor on a double-click. */
  editingTextElement?: { id?: string } | null
}

/** What a reader's gesture on a node turns into. */
export interface NodeGestures {
  /** One element newly selected — a plain click, once the press behind it settles. */
  clicked: (element: MaybeNodeElement, view: DrawingView) => void
  /** A text element opened for typing, which is Excalidraw's own answer to a double-click. */
  editing: (element: MaybeNodeElement, view: DrawingView) => void
}

/** What the "send to drawing" action needs a drawing surface to do. */
export interface DrawingSurface {
  /** Why the surface cannot be used, or `undefined` when it can. */
  unavailable(): string | undefined
  /** The drawings to offer, in the order to offer them. */
  choices(): DrawingChoice[]
  /** Puts the note at `notePath` on `drawing` as an embeddable at the cursor, and saves. */
  place(drawing: DrawingChoice, notePath: string): Promise<void>
}

/**
 * A live Excalidraw view. A click carries its own, the only handle on a drawing
 * embedded in a note; Obsidian's `FileView` is one.
 */
export interface DrawingView {
  readonly file: TFile | null
}

/** What a node's drawing says about it, at the moment it was asked. */
export interface NodeReading {
  box: Box
  inputs: NodeInputs
  /** The editable field, defaulting to one on drawings not yet upgraded. */
  runCount?: string
  /** The drawing's path, which a wiki link on it resolves against. */
  drawing: string
}

/** One output of a run: where it goes, and the note it shows. */
export interface PlacedOutput {
  placed: FramedPanel
  notePath: string
}

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

/** Every role starts here: an Excalidraw missing or too old is a notice, not a throw. */
interface Reachable {
  /** Why Excalidraw cannot be used, or `undefined` when it can. */
  unavailable(): string | undefined
}

/** Brings old nodes on the clicked drawing up to the current count control. */
interface RunCountMigration {
  upgradeRunCounts(): Promise<boolean>
}

/**
 * One gesture's drawing: the click's own view, or else the tab in front, bound
 * once. Throws when there is no drawing to bind.
 */
type BindDrawing<Drawing> = (view?: DrawingView) => Drawing

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

export interface NodeSurface extends Reachable {
  /** Whether the tab in front of the reader is a drawing to put a node on. */
  hasActiveDrawing(): boolean
  on: BindDrawing<NodeDrawing>
}

/** Landing a run on one drawing: its node's status line, its frame and its outputs. */
export interface RunDrawing extends RunCountMigration {
  /** What a node is bound to and where it sits; `undefined` when it is gone. */
  read(target: NodeTarget): NodeReading | undefined
  /** Rewrites the node's `▶ Run` line. `false` means the node is no longer there. */
  setRunStatus(target: NodeTarget, status: NodeRunStatus): Promise<boolean>
  /** `false` means no frame could be made and the outputs landed loose. */
  placeRun(frame: RunFrame, outputs: readonly PlacedOutput[]): Promise<boolean>
  /** Replaces only unreached cards in a newly started run with its waiting hold. */
  placeHold(frame: RunFrame, hold: HoldRecord, pending: readonly number[]): Promise<void>
  /** Makes enlarged waiting frames leave room for the other runs of the same click. */
  stackRuns(runIds: readonly string[]): Promise<void>
}

export interface RunSurface extends Reachable {
  on: BindDrawing<RunDrawing>
}

/** Moving one drawing's cards, labels and frames on to a rerun that landed. */
export interface RerunDrawing {
  /** Adds the first in-place answer beside its candidate. */
  placePickRow(landing: RerunLanding, outputs: readonly { index: number; panel: LayoutPanel; notePath: string }[]): Promise<boolean>
  updatePickCounts(landing: RerunLanding): Promise<boolean>
  /** Replaces a rerolled candidate set in its reserved column. */
  refreshHoldColumn(runId: string, nodeId: string, hold: HoldRecord): Promise<boolean>
  /**
   * Moves the drawing on to a landed rerun: each card of the runs `from` to the
   * note `noteFor` files for its output, and the labels and frames to `to`.
   * `false` when the drawing shows none of `from`.
   */
  followRerun(
    from: readonly string[],
    to: string,
    noteFor: (output: string) => Promise<string | undefined>,
  ): Promise<boolean>
}

export interface RerunSurface extends Reachable {
  /** Every drawing open in a view now; a drawing in a tab not yet loaded is not one. */
  openViews(): DrawingView[]
  on: BindDrawing<RerunDrawing>
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

export interface ProposalSurface extends Reachable {
  on: BindDrawing<ProposalDrawing>
}

/** Reading which run the reader's selection or click belongs to. */
export interface SelectionSurface extends Reachable {
  /** The run the selection on the tab in front belongs to: a Direct label's, or a card's output note's. */
  selectedRun(): string | undefined
  /** The run and proposal a card on the drawing shows, by its output note. */
  cardProposal(element: MaybeNodeElement, on: DrawingView): CardProposal | undefined
  /** The drilled-in Continue line, when selection did not change on a second click. */
  on?: BindDrawing<PickDrawing>
}

export interface PickDrawing {
  selectedContinue(): MaybeNodeElement | undefined
  selectedReroll(): MaybeNodeElement | undefined
}

/** Excalidraw, in every role this plugin gives it. */
export type ExcalidrawSurface = NodeSurface & RunSurface & RerunSurface & ProposalSurface & SelectionSurface

/** Said when Expand is asked for and the selection is not one readable block. */
export const SELECT_ONE_BLOCK =
  'Select one text block or embedded note on the drawing to expand it.'

export const NO_EXCALIDRAW =
  'Excalidraw is not installed or not enabled. The drawing surface needs it — install the community plugin.'
export const OLD_EXCALIDRAW = `This Excalidraw is too old for Chain Runner; update it to ${MINIMUM_VERSION} or newer.`

export function createDrawingSurface(app: App): DrawingSurface {
  return {
    unavailable: () => unavailableReason(app),
    choices: () =>
      drawingChoices({
        files: app.vault
          .getFiles()
          .filter(file => isDrawing(app, file))
          .map(file => ({ path: file.path, name: file.basename, mtime: file.stat.mtime })),
        open: openDrawings(app),
        // Newest-first, and may name deleted files; `drawingChoices` drops those.
        recent: app.workspace.getLastOpenFiles(),
      }),
    place: async (drawing, notePath) => {
      const ea = automate(app)
      if (!ea) throw new Error(NO_EXCALIDRAW)
      const bound = ea.getAPI(await openDrawing(app, drawing.path))
      embedNote(app, bound, { x: 0, y: 0, width: EMBEDDABLE_WIDTH, height: EMBEDDABLE_HEIGHT }, notePath)
      // Reposition to the cursor, and save.
      await save(bound, true)
    },
  }
}

/** Said when a chain-node action cannot find the drawing it is meant to act on. */
export const NOT_A_DRAWING = 'Open the Excalidraw drawing as its own tab to do that.'

export interface ExcalidrawSurfaceOptions {
  canReroll?: () => boolean
}

export function createExcalidrawSurface(app: App, options?: ExcalidrawSurfaceOptions): ExcalidrawSurface {
  /** The one place a gesture reaches Excalidraw. A click's own view wins: a drawing embedded in a note is not a tab. */
  const bind = (view?: DrawingView): BoundDrawing => {
    const ea = automate(app)
    if (!ea) throw new Error(NO_EXCALIDRAW)
    const drawing = view ?? activeDrawing(app)
    if (!drawing) throw new Error(NOT_A_DRAWING)
    return new BoundDrawing(app, ea.getAPI(drawing), drawing, options)
  }

  return {
    unavailable: () => unavailableReason(app),
    hasActiveDrawing: () => activeDrawing(app) !== undefined,
    on: bind,
    openViews: () => {
      const views: DrawingView[] = []
      eachLeaf(app, leaf => {
        const view = excalidrawView(leaf)
        if (view) views.push(view)
      })
      return views
    },
    selectedRun: () => bind().selectedRun(),
    // Every element a hook hands over is a scene element.
    cardProposal: (element, on) => cardProposal(element as SceneShape, noteFrontmatter(app, on)),
  }
}

/**
 * One drawing, bound once for one gesture. Its own EA instance rather than the
 * shared one, whose binding any other action or tab can move while this one awaits.
 */
class BoundDrawing implements NodeDrawing, RunDrawing, RerunDrawing, ProposalDrawing, PickDrawing {
  constructor(
    private readonly app: App,
    private readonly ea: ExcalidrawAutomate,
    private readonly view: DrawingView,
    private readonly options?: ExcalidrawSurfaceOptions,
  ) {}

  /** The instance, its workbench emptied so a write carries only its own elements. */
  private emptied(): ExcalidrawAutomate {
    this.ea.reset()
    return this.ea
  }

  async place(elements: ChainNodeElement[]): Promise<void> {
    const ea = this.emptied()
    const ids = elements.map(element => draw(ea, element))
    // One group, so the node's elements move, copy and delete together.
    if (ids.length > 1) ea.addToGroup(ids)
    // Reposition to the cursor.
    await save(ea, true)
  }

  setParameter(target: NodeTarget, value: string): Promise<boolean> {
    return write(this.emptied(), parameterEdits(this.ea.getViewElements(), target, value))
  }

  setRunCount(target: NodeTarget, count: number): Promise<boolean> {
    return write(this.emptied(), runCountEdits(this.ea.getViewElements(), target, count))
  }

  setChain(target: NodeTarget, chain: ChainSummary, value?: string): Promise<boolean> {
    const reshape = chainEdits(this.ea.getViewElements(), target, chain, value)
    return write(this.emptied(), reshape.edits, reshape.removals, reshape.additions)
  }

  reflow(): Promise<boolean> {
    const scene = this.ea.getViewElements()
    // Every node is asked; only one the reader dragged answers with anything.
    const edits = nodeTargets(scene).flatMap(target => reflowEdits(scene, target))
    return write(this.emptied(), edits)
  }

  async upgradeRunCounts(): Promise<boolean> {
    const scene = this.ea.getViewElements()
    let changed = false
    for (const target of nodeTargets(scene)) {
      const upgrade = runCountUpgrade(scene, target)
      if (await write(this.emptied(), upgrade.edits, upgrade.removals, upgrade.additions)) changed = true
    }
    return changed
  }

  selectedNode(): MaybeNodeElement | undefined {
    const selected = selectedElements(this.ea)
    // One element, so a double-click on a rubber-banded group runs nothing.
    const only = selected.length === 1 ? selected[0] : undefined
    return only && chainNodeData(only) ? only : undefined
  }

  read(target: NodeTarget): NodeReading | undefined {
    const scene = this.ea.getViewElements()
    const box = nodeBox(scene, target)
    if (!box) return undefined
    return {
      box,
      inputs: resolveInputs(scene, target, imageNoteLookup(this.ea)),
      runCount: nodeRunCount(scene, target) ?? '1',
      drawing: drawingPath(this.view),
    }
  }

  setRunStatus(target: NodeTarget, status: NodeRunStatus): Promise<boolean> {
    return write(this.emptied(), runEdits(this.ea.getViewElements(), target, status))
  }

  async placeRun(frame: RunFrame, outputs: readonly PlacedOutput[]): Promise<boolean> {
    const ea = this.emptied()

    // First, so the panels can name it as their container.
    const frameId = ea.addFrame?.(frame.box.x, frame.box.y, frame.box.width, frame.box.height, frame.name)
    const madeFrame = frameId ? ea.getElement(frameId) : undefined
    if (madeFrame) madeFrame.customData = reframe(madeFrame.customData, frame.runId)

    for (const { placed, notePath } of outputs) {
      ea.style.strokeWidth = placed.emphasis ? EMPHASIS_STROKE : PLAIN_STROKE
      const element = embedNote(this.app, ea, placed.box, notePath)
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

  async placeHold(frame: RunFrame, hold: HoldRecord, pending: readonly number[]): Promise<void> {
    const scene = this.ea.getViewElements()
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
    const canReroll = this.options?.canReroll?.() ?? false
    const column = buildHoldColumn(hold, right + 24, frame.box.y + 32, { canReroll })
    const nextBox = waitingFrameBox(frame.box, reached.map(panel => panel.box), [
      column.box,
      ...prior.map(element => ({ x: element.x ?? 0, y: element.y ?? 0, width: element.width ?? 0, height: element.height ?? 0 })),
    ])
    const ea = this.emptied()
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
    this.drawHoldColumn(ea, column, frame.runId, hold, belonging?.id)
    await save(ea, false)
  }

  async refreshHoldColumn(runId: string, nodeId: string, hold: HoldRecord): Promise<boolean> {
    const scene = this.ea.getViewElements()
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
    const ea = this.emptied()
    ea.copyViewElementsToEAforEditing(old)
    for (const element of old) {
      const copy = ea.getElement(element.id)
      if (copy) copy.isDeleted = true
    }
    const canReroll = this.options?.canReroll?.() ?? false
    const next = buildHoldColumn(hold, column.x ?? 0, column.y ?? 0, { canReroll })
    const frame = scene.find(element => element.id === column.frameId)
    if (frame) {
      ea.copyViewElementsToEAforEditing([frame])
      const copy = ea.getElement(frame.id)
      if (copy) copy.height = Math.max(copy.height ?? 0, next.box.y + next.box.height + 32 - (copy.y ?? 0))
    }
    this.drawHoldColumn(ea, next, runId, hold, column.frameId ?? undefined)
    await save(ea, false)
    return true
  }

  private drawHoldColumn(ea: ExcalidrawAutomate, column: HoldColumn, runId: string, hold: HoldRecord, frameId?: string): void {
    const columnStamp: HoldStamp = { runId, nodeId: hold.nodeId, heading: '', revision: hold.revision, role: 'column' }
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
    ea.style.strokeColor = GREY
    ea.style.strokeStyle = 'dashed'
    const custom = ea.getElement(ea.addText(column.custom.x, column.custom.y, 'Write your own', {
      box: 'box', boxPadding: 12, width: column.custom.width,
    }))
    if (custom) {
      custom.customData = stampHold(columnStamp)
      custom.height = column.custom.height
      if (frameId) custom.frameId = frameId
    }
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

  async stackRuns(runIds: readonly string[]): Promise<void> {
    const scene = this.ea.getViewElements()
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
    const ea = this.emptied()
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
  ): Promise<boolean> {
    const found = rerunScene(this.ea.getViewElements(), from, to, noteFrontmatter(this.app, this.view))
    if (!found) return false
    const notePaths = new Map<SceneElement, string>()
    for (const card of found.cards) {
      const notePath = await noteFor(card.output)
      if (notePath) notePaths.set(card.element, notePath)
    }

    const ea = this.emptied()
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
        frame.name = name
        if (frameRunId(frame)) frame.customData = reframe(frame.customData, to)
      }
    }
    await save(ea, false)
    return true
  }

  selection(): BlockReading | undefined {
    const selected = selectedElements(this.ea)
    if (selected.length !== 1) return undefined
    const element = selected[0]
    // Our own furniture is not material to expand: a node, or another proposal.
    if (!element || chainNodeData(element) || proposalData(element)) return undefined
    const input = blockInput(element, this.ea.getViewElements(), imageNoteLookup(this.ea))
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
      drawing: drawingPath(this.view),
    }
  }

  async placeProposals(proposals: readonly PlacedProposal[], source: BlockReading): Promise<void> {
    const ea = this.emptied()
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

      const card = embedNote(this.app, ea, box, notePath)
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
    for (const element of selectedElements(this.ea)) {
      const data = proposalData(element)
      if (data) return data
    }
    return undefined
  }

  async editProposal(proposalId: string, action: 'accept' | 'dismiss'): Promise<boolean> {
    const scene = this.ea.getViewElements()
    const edits: ProposalEdits<SceneElement> =
      action === 'accept' ? acceptEdits(scene, proposalId) : dismissEdits(scene, proposalId)
    const touched = [...edits.normalise, ...edits.remove]
    if (touched.length === 0) return false

    const ea = this.emptied()
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

  /** The run the reader's selection belongs to: a Direct label's, or a card's output note's. */
  selectedRun(): string | undefined {
    const selected = selectedElements(this.ea)
    return selected.map(element => holdStamp(element)?.runId).find(Boolean)
      ?? selectedRunId(selected, noteFrontmatter(this.app, this.view))
  }

  private selectedHoldRole(role: HoldStamp['role']): MaybeNodeElement | undefined {
    const selected = selectedElements(this.ea)
    const only = selected.length === 1 ? selected[0] : undefined
    return only && holdStamp(only)?.role === role ? only : undefined
  }

  selectedContinue(): MaybeNodeElement | undefined {
    return this.selectedHoldRole('continue')
  }

  selectedReroll(): MaybeNodeElement | undefined {
    return this.selectedHoldRole('reroll')
  }

  async placePickRow(landing: RerunLanding, outputs: readonly { index: number; panel: LayoutPanel; notePath: string }[]): Promise<boolean> {
    const pick = landing.pick
    if (!pick) return false
    const scene = this.ea.getViewElements()
    if (scene.some(element => {
      const stamp = pickStamp(element)
      return stamp?.runId === landing.runId && stamp.nodeId === pick.nodeId && stamp.heading === pick.heading
    })) return true
    const candidate = scene.find(element => {
      const stamp = holdStamp(element)
      return stamp?.role === 'candidate' && stamp.runId === landing.runId && stamp.nodeId === pick.nodeId
        && stamp.heading === pick.heading && element.type !== 'text'
    })
    if (!candidate) return false
    const frame = scene.find(element => element.type === 'frame' && element.id === candidate.frameId)
    const reroll = scene.find(element => {
      const stamp = holdStamp(element)
      return stamp?.role === 'reroll' && (stamp.runId === landing.runId || landing.from.includes(stamp.runId)) && stamp.nodeId === pick.nodeId
    })
    const row = buildPickRow({ x: candidate.x ?? 0, y: candidate.y ?? 0, width: candidate.width ?? 0, height: candidate.height ?? 0 }, outputs.length)
    const ea = this.emptied()
    const edited = [candidate, ...(frame ? [frame] : []), ...(reroll ? [reroll] : [])]
    ea.copyViewElementsToEAforEditing(edited)
    if (reroll) {
      const copy = ea.getElement(reroll.id)
      if (copy) copy.isDeleted = true
    }
    const chosen = ea.getElement(candidate.id)
    if (chosen) chosen.strokeStyle = 'solid'
    const enclosing = frame ? ea.getElement(frame.id) : undefined
    if (enclosing) enclosing.width = Math.max(enclosing.width ?? 0, row.right + 32 - (enclosing.x ?? 0))
    const stamp = { runId: landing.runId, nodeId: pick.nodeId, heading: pick.heading }
    const mark = (element: SceneElement | undefined): void => {
      if (!element) return
      element.customData = { ...(typeof element.customData === 'object' && element.customData !== null ? element.customData : {}), ...stampPick(stamp) }
      if (frame) element.frameId = frame.id
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
        const card = embedNote(this.app, ea, box, output.notePath)
        if (card) {
          card.customData = { ...stampPick(stamp), chainRunnerPanel: { runId: landing.runId, index: output.index } }
          if (frame) card.frameId = frame.id
        }
        mark(ea.getElement(ea.addText(step.x, step.y, output.panel.name)))
        const count = ea.getElement(ea.addText(length.x, length.y, `${output.panel.lines} lines`))
        mark(count)
        if (count) count.customData = { ...(count.customData as Record<string, unknown>), chainRunnerPickCount: output.index }
      }
      ea.style.strokeColor = LINK_BLUE
      const direct = ea.getElement(ea.addText(row.direct.x, row.direct.y, '✎ Direct'))
      if (direct) {
        direct.customData = { ...stampPick(stamp), ...relabel(direct.customData, landing.runId) }
        direct.link = 'chain-runner://direct'
        if (frame) direct.frameId = frame.id
      }
    }
    await save(ea, false)
    return true
  }

  async updatePickCounts(landing: RerunLanding): Promise<boolean> {
    const scene = this.ea.getViewElements()
    const changed = scene.filter(element => {
      const stamp = pickStamp(element)
      const index = (element.customData as Record<string, unknown> | undefined)?.chainRunnerPickCount
      return stamp?.runId === landing.runId && typeof index === 'number'
        && element.rawText !== `${landing.panels[index]?.lines ?? 0} lines`
    })
    if (changed.length === 0) return false
    const ea = this.emptied()
    ea.copyViewElementsToEAforEditing(changed)
    for (const element of changed) {
      const copy = ea.getElement(element.id)
      const index = (element.customData as Record<string, unknown>).chainRunnerPickCount as number
      if (!copy) continue
      const value = `${landing.panels[index]?.lines ?? 0} lines`
      copy.text = copy.originalText = copy.rawText = value
      ea.refreshTextElementSize?.(copy.id)
    }
    await save(ea, false)
    return true
  }
}

function panelStamp(element: SceneElement): { runId: string; index: number } | undefined {
  const data = element.customData
  if (!data || typeof data !== 'object') return undefined
  const stamp = (data as Record<string, unknown>).chainRunnerPanel
  if (!stamp || typeof stamp !== 'object') return undefined
  const { runId, index } = stamp as Record<string, unknown>
  return typeof runId === 'string' && typeof index === 'number' ? { runId, index } : undefined
}

/**
 * A note on the scene. The link is what an arrow out of the embeddable reads it
 * back by (`./nodeScene.ts`), so it is set here rather than left to Excalidraw's
 * own bookkeeping — which is how an output becomes the next run's input.
 */
function embedNote(app: App, ea: ExcalidrawAutomate, box: Box, notePath: string): SceneElement | undefined {
  // Gone since it was written: the rest of the scene still lands.
  const note = app.vault.getAbstractFileByPath(notePath)
  if (!(note instanceof TFile)) return undefined
  const id = ea.addEmbeddable(box.x, box.y, box.width, box.height, undefined, note)
  const element = ea.getElement(id)
  if (element && !element.link) element.link = `[[${note.path}]]`
  return element
}

/** Said when a gesture's drawing was closed before it could be written to. */
export const DRAWING_CLOSED = 'That drawing was closed, so nothing was written to it.'

/** Writes the workbench to the view and saves; `repositionToCursor` for what lands at the cursor. */
async function save(ea: ExcalidrawAutomate, repositionToCursor: boolean): Promise<void> {
  // `false` is Excalidraw's word for a view that has unloaded since it was bound.
  if (!(await ea.addElementsToView(repositionToCursor, true))) throw new Error(DRAWING_CLOSED)
}

/** Outputs the layout is about are drawn heavier. */
const EMPHASIS_STROKE = 4
const PLAIN_STROKE = 1

/**
 * The note an image element draws. `Insert file from vault` renders a note as an
 * image whose file is Excalidraw's own bookkeeping, not a link we can read; only
 * a markdown note has a body to read, so a picture is not one.
 */
function imageNoteLookup(ea: ExcalidrawAutomate): ImageNoteLookup {
  return element => {
    // An Excalidraw that cannot say is too old to read an image at all.
    if (!ea.getViewFileForImageElement) throw new Error(OLD_EXCALIDRAW)
    const note = ea.getViewFileForImageElement(element)
    return note && note.extension === 'md' ? note.path : undefined
  }
}

/** What the reader has selected; an Excalidraw that cannot say is too old to expand on. */
function selectedElements(ea: ExcalidrawAutomate): SceneElement[] {
  if (!ea.getViewSelectedElements) throw new Error(OLD_EXCALIDRAW)
  return ea.getViewSelectedElements()
}

/** An accepted proposal is ordinary material: nothing left saying it was one. */
function withoutProposal(custom: unknown): unknown {
  if (typeof custom !== 'object' || custom === null) return custom
  const rest = { ...(custom as Record<string, unknown>) }
  delete rest['chainRunnerProposal']
  return Object.keys(rest).length === 0 ? undefined : rest
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

/** The drawing a view is showing, as a vault path; `''` when it has no file. */
function drawingPath(view: DrawingView): string {
  return view.file?.path ?? ''
}

/** A linked note's frontmatter, resolving the link from the drawing it sits on. */
function noteFrontmatter(app: App, view: DrawingView): NoteFrontmatter {
  const drawing = drawingPath(view)
  return linkpath => {
    const note = app.metadataCache.getFirstLinkpathDest(linkpath, drawing)
    return note ? app.metadataCache.getFileCache(note)?.frontmatter : undefined
  }
}

/** Why Excalidraw cannot be used right now, or `undefined` when it can. */
function unavailableReason(app: App): string | undefined {
  const ea = automate(app)
  if (!ea) return NO_EXCALIDRAW
  return ea.verifyMinimumPluginVersion(MINIMUM_VERSION) ? undefined : OLD_EXCALIDRAW
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

/**
 * Intercepts link clicks so a chain node's own links never open anything. What
 * the handler does not claim falls through to the previous hook, which the
 * returned function puts back. EA holds one hook, so the last installer wins.
 */
export function registerLinkHook(
  app: App,
  handler: (element: MaybeNodeElement, view: DrawingView) => boolean,
): () => void {
  const ea = automate(app)
  if (!ea) return () => {}
  const previous = ea.onLinkClickHook
  ea.onLinkClickHook = (element, linkText, event, view, self) => {
    if (!handler(element, view)) return false
    return previous ? previous(element, linkText, event, view, self) : true
  }
  return () => {
    ea.onLinkClickHook = previous
  }
}

/**
 * Intercepts a plain click, which Excalidraw reports only as a change of
 * selection. `SelectionClicks` decides which of those changes is a click
 * (ADR-0010); this only reaches the hook and hands over the element.
 */
export function registerSelectionHook(app: App, gestures: NodeGestures): () => void {
  const ea = automate(app)
  if (!ea) return () => {}
  const previous = ea.onSceneChangeHook ?? undefined
  const clicks = new SelectionClicks()
  let editing: string | undefined
  ea.onSceneChangeHook = {
    // Ours on top of what the previous hook asked for, so chaining never narrows it.
    appStateKeys: [
      ...new Set([...(previous?.appStateKeys ?? []), 'selectedElementIds', 'editingTextElement']),
    ],
    ...(previous?.trackElements ? { trackElements: true } : {}),
    ...(previous?.triggerWhenInvisible ? { triggerWhenInvisible: true } : {}),
    callback: (elements, appState, files, view, self) => {
      const opened = appState?.editingTextElement?.id
      if (opened !== undefined && opened !== editing) {
        const element = elements.find(one => one.id === opened)
        if (element) gestures.editing(element, view)
      }
      editing = opened ?? undefined

      const id = clicks.clicked(appState?.selectedElementIds)
      const clicked = id === undefined ? undefined : elements.find(element => element.id === id)
      if (clicked) gestures.clicked(clicked, view)
      previous?.callback(elements, appState, files, view, self)
    },
  }
  return () => {
    ea.onSceneChangeHook = previous ?? null
  }
}

/** The drawing in front of the reader, or `undefined` when the tab is something else. */
function activeDrawing(app: App): DrawingView | undefined {
  const leaf = app.workspace.getMostRecentLeaf()
  return leaf ? excalidrawView(leaf) : undefined
}

/** The leaf's view when it is Excalidraw's; a drawing open as markdown is not one. */
function excalidrawView(leaf: WorkspaceLeaf): DrawingView | undefined {
  return leaf.view.getViewType() === EXCALIDRAW_VIEW ? (leaf.view as FileView) : undefined
}

/** Excalidraw's own plugin instance, or `undefined` when it is not loaded. */
function excalidrawPlugin(app: App): ExcalidrawPluginInstance | undefined {
  // Through the plugin instance, not the window global, to keep the dependency
  // explicit (`docs/spike-ea.md`).
  const plugins = (app as unknown as { plugins?: { plugins?: Record<string, ExcalidrawPluginInstance> } }).plugins
  return plugins?.plugins?.[PLUGIN_ID]
}

/** The slice of Excalidraw's plugin object this plugin reads. */
interface ExcalidrawPluginInstance {
  ea?: ExcalidrawAutomate
  settings?: { scriptFolderPath?: string }
}

function automate(app: App): ExcalidrawAutomate | undefined {
  return excalidrawPlugin(app)?.ea
}

/**
 * The folder Excalidraw loads its scripts from; its own setting, and its own
 * default. `undefined` when Excalidraw is not there — a vault without it has no
 * use for a script folder, and nothing should make one.
 */
export function scriptFolder(app: App): string | undefined {
  const plugin = excalidrawPlugin(app)
  if (!plugin) return undefined
  return normalizePath(plugin.settings?.scriptFolderPath?.trim() || DEFAULT_SCRIPT_FOLDER)
}

/** The vault as the toolbar script is written to it, folders made on the way. */
export function createScriptVault(app: App): ScriptVault {
  const adapter = app.vault.adapter
  return {
    read: async path => ((await adapter.exists(path)) ? adapter.read(path) : undefined),
    write: async (path, content) => {
      const folder = path.slice(0, path.lastIndexOf('/'))
      if (folder && !(await adapter.exists(folder))) await adapter.mkdir(folder)
      await adapter.write(path, content)
    },
  }
}

/**
 * Whether a file is a drawing. The path covers Excalidraw's own file shapes; an
 * ordinary note marked as a drawing shows only in its frontmatter.
 */
function isDrawing(app: App, file: TFile): boolean {
  if (isDrawingPath(file.path)) return true
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter
  return frontmatter?.['excalidraw-plugin'] !== undefined
}

/** The drawings with a tab of their own right now, in the workspace's own order. */
function openDrawings(app: App): string[] {
  const paths: string[] = []
  eachLeaf(app, (_leaf, file) => {
    if (file && isDrawing(app, file)) paths.push(file.path)
  })
  return paths
}

/** Every leaf and the file it holds; the one place a view is assumed to know its file. */
function eachLeaf(app: App, visit: (leaf: WorkspaceLeaf, file: TFile | undefined) => void): void {
  app.workspace.iterateAllLeaves(leaf => visit(leaf, (leaf.view as FileView).file ?? undefined))
}

/**
 * The drawing's live view: the tab it is already in, or a new one. The view is
 * waited for because binding a half-built one fails silently (`docs/spike-ea.md`).
 */
async function openDrawing(app: App, path: string): Promise<DrawingView> {
  const file = app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile)) throw new Error(`That drawing is no longer in the vault: ${path}`)

  let leaf = leafShowing(app, path)
  if (!leaf) {
    leaf = app.workspace.getLeaf(true)
    await leaf.openFile(file)
  }
  await app.workspace.revealLeaf(leaf)

  const deadline = Date.now() + VIEW_READY_TIMEOUT_MS
  while (leaf.view.getViewType() !== EXCALIDRAW_VIEW) {
    if (Date.now() > deadline) throw new Error('That drawing did not open as an Excalidraw view.')
    await new Promise(resolve => setTimeout(resolve, VIEW_READY_POLL_MS))
  }
  return leaf.view as FileView
}

/**
 * The Excalidraw tab showing this drawing, if there is one. The view type is
 * matched too: a `.excalidraw.md` open as plain markdown is not one EA can use.
 */
function leafShowing(app: App, path: string): WorkspaceLeaf | undefined {
  let found: WorkspaceLeaf | undefined
  eachLeaf(app, (leaf, file) => {
    if (!found && file?.path === path && leaf.view.getViewType() === EXCALIDRAW_VIEW) found = leaf
  })
  return found
}
