import { TFile, normalizePath, type App, type WorkspaceLeaf } from 'obsidian'
import { drawingChoices, isDrawingPath, type DrawingChoice } from './drawingChoices'
import {
  chainEdits,
  chainNodeData,
  nodeTargets,
  parameterEdits,
  reflowEdits,
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
import { buildDirectLabel, cardProposal, relabel, rerunScene, selectedRunId, type CardProposal, type NoteFrontmatter } from './runLabel'
import { SelectionClicks, type SelectedIds } from './selectionClick'
import { DEFAULT_SCRIPT_FOLDER, type ScriptVault } from './toolScript'
import type { ChainSummary } from '../engine/types'
import type { FramedPanel, RunFrame } from '../run/runFrame'

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
  reset(): void
  setView(view: unknown): void
  style: ElementStyle
  addEmbeddable(x: number, y: number, width: number, height: number, url?: string, file?: TFile): string
  addRect(x: number, y: number, width: number, height: number): string
  /** Feature-detected: the spike verified the other `add*` calls, not this one. */
  addArrow?(points: [number, number][], formatting?: ArrowFormatting): string
  /** Feature-detected: the spike verified the other `add*` calls, not this one. */
  addFrame?(x: number, y: number, width: number, height: number, name?: string): string
  addText(x: number, y: number, text: string, formatting?: TextFormatting): string
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
  view: unknown,
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
    view: unknown,
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
 * A live Excalidraw view: opaque, since it is only handed back to `setView`. A
 * click carries its own view, the only handle on a drawing embedded in a note.
 */
export type DrawingView = unknown

/** What a node's drawing says about it, at the moment it was asked. */
export interface NodeReading {
  box: Box
  inputs: NodeInputs
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

/** What the chain-node actions need a drawing to do. */
export interface NodeSurface {
  /** Why Excalidraw cannot be used, or `undefined` when it can. */
  unavailable(): string | undefined
  /** Whether the tab in front of the reader is a drawing to put a node on. */
  hasActiveDrawing(): boolean
  /** Puts a built node on that drawing, at the cursor, and saves. */
  place(elements: ChainNodeElement[], on?: DrawingView): Promise<void>
  /** Rewrites a node's parameter in place. `false` means the node is no longer there. */
  setParameter(target: NodeTarget, value: string, on?: DrawingView): Promise<boolean>
  /** Re-shapes a node around another chain. `false` means the node is no longer there. */
  setChain(target: NodeTarget, chain: ChainSummary, value?: string, on?: DrawingView): Promise<boolean>
  /**
   * Cuts every resized node's lines to its new width. `false` when there was
   * nothing to do, which is every drawing the reader has not just dragged one on.
   */
  reflow(on?: DrawingView): Promise<boolean>
  /** What a node is bound to and where it sits; `undefined` when it is gone. */
  read(target: NodeTarget, on?: DrawingView): NodeReading | undefined
  /** Rewrites the node's `▶ Run` line. `false` means the node is no longer there. */
  setRunStatus(target: NodeTarget, status: NodeRunStatus, on?: DrawingView): Promise<boolean>
  /** `false` means no frame could be made and the outputs landed loose. */
  placeRun(frame: RunFrame, outputs: readonly PlacedOutput[], on?: DrawingView): Promise<boolean>
  /** The one block the reader has selected, or `undefined` when it is not one we can read. */
  selection(on?: DrawingView): BlockReading | undefined
  /** Draws a run's proposals greyed and dashed, each connected back to `source`. */
  placeProposals(proposals: readonly PlacedProposal[], source: BlockReading, on?: DrawingView): Promise<void>
  /** The run the reader's selection belongs to: a Direct label's, or a card's output note's. */
  selectedRun(on?: DrawingView): string | undefined
  /** The run and proposal a card on the drawing shows, by its output note. */
  cardProposal(element: unknown, on: DrawingView): CardProposal | undefined
  /** The proposal the reader has selected, for the commands that decide one. */
  selectedProposal(on?: DrawingView): ProposalData | undefined
  /** The one node element the reader has selected, for the gestures the hook cannot see. */
  selectedNode(on?: DrawingView): MaybeNodeElement | undefined
  /** Every drawing open in a view now; a drawing in a tab not yet loaded is not one. */
  openViews(): DrawingView[]
  /**
   * Moves a drawing on to a landed rerun: each card of the runs `from` to the
   * note `noteFor` files for its output, and the labels and frames to `to`.
   * `false` when the drawing shows none of `from`.
   */
  followRerun(
    from: readonly string[],
    to: string,
    noteFor: (output: string) => Promise<string | undefined>,
    on: DrawingView,
  ): Promise<boolean>
  /** Keeps or drops a proposal. `false` means it is no longer on the drawing. */
  editProposal(proposalId: string, action: 'accept' | 'dismiss', on?: DrawingView): Promise<boolean>
}

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
      const view = await openDrawing(app, drawing.path)
      ea.reset()
      // The binding goes stale when the reader switches tabs, so it is set per call.
      ea.setView(view)
      embedNote(app, ea, { x: 0, y: 0, width: EMBEDDABLE_WIDTH, height: EMBEDDABLE_HEIGHT }, notePath)
      // Reposition to the cursor, and save.
      await ea.addElementsToView(true, true)
    },
  }
}

/** Said when a chain-node action cannot find the drawing it is meant to act on. */
export const NOT_A_DRAWING = 'Open the Excalidraw drawing as its own tab to do that.'

export function createNodeSurface(app: App): NodeSurface {
  /**
   * The one place a node action reaches Excalidraw. A click's own view wins over
   * the tab in front: a drawing embedded in a note is not a tab.
   */
  const bind = (on?: DrawingView): { ea: ExcalidrawAutomate; view: DrawingView } => {
    const ea = automate(app)
    if (!ea) throw new Error(NO_EXCALIDRAW)
    const view = on ?? activeDrawing(app)
    if (!view) throw new Error(NOT_A_DRAWING)
    ea.reset()
    // The binding goes stale when the reader switches tabs, so it is set per call.
    ea.setView(view)
    return { ea, view }
  }

  return {
    unavailable: () => unavailableReason(app),

    hasActiveDrawing: () => activeDrawing(app) !== undefined,

    place: async (elements, on) => {
      const { ea } = bind(on)
      const ids = elements.map(element => draw(ea, element))
      // One group, so the node's elements move, copy and delete together.
      if (ids.length > 1) ea.addToGroup(ids)
      // Reposition to the cursor.
      await ea.addElementsToView(true, true)
    },

    setParameter: async (target, value, on) => {
      const { ea } = bind(on)
      return write(ea, parameterEdits(ea.getViewElements(), target, value))
    },

    setChain: async (target, chain, value, on) => {
      const { ea } = bind(on)
      const reshape = chainEdits(ea.getViewElements(), target, chain, value)
      return write(ea, reshape.edits, reshape.removals, reshape.additions)
    },

    reflow: async on => {
      const { ea } = bind(on)
      const scene = ea.getViewElements()
      // Every node is asked; only one the reader dragged answers with anything.
      const edits = nodeTargets(scene).flatMap(target => reflowEdits(scene, target))
      return write(ea, edits)
    },

    setRunStatus: async (target, status, on) => {
      const { ea } = bind(on)
      return write(ea, runEdits(ea.getViewElements(), target, status))
    },

    read: (target, on) => {
      const { ea, view } = bind(on)
      const scene = ea.getViewElements()
      const box = nodeBox(scene, target)
      if (!box) return undefined
      return { box, inputs: resolveInputs(scene, target, imageNoteLookup(ea)), drawing: drawingPath(view) }
    },

    selection: on => {
      const { ea, view } = bind(on)
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
    },

    selectedNode: on => {
      const { ea } = bind(on)
      const selected = selectedElements(ea)
      // One element, so a double-click on a rubber-banded group runs nothing.
      const only = selected.length === 1 ? selected[0] : undefined
      return only && chainNodeData(only) ? only : undefined
    },

    selectedRun: on => {
      const { ea, view } = bind(on)
      return selectedRunId(selectedElements(ea), noteFrontmatter(app, view))
    },

    cardProposal: (element, on) => cardProposal(element as SceneShape, noteFrontmatter(app, on)),

    selectedProposal: on => {
      const { ea } = bind(on)
      for (const element of selectedElements(ea)) {
        const data = proposalData(element)
        if (data) return data
      }
      return undefined
    },

    placeProposals: async (proposals, source, on) => {
      const { ea } = bind(on)
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

        const card = embedNote(app, ea, box, notePath)
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
      ea.style.strokeColor = ACCEPTED_STROKE
      ea.style.strokeStyle = ACCEPTED_STROKE_STYLE
      // Not repositioned to the cursor: the coordinates are the source block's own.
      await ea.addElementsToView(false, true)
    },

    editProposal: async (proposalId, action, on) => {
      const { ea } = bind(on)
      const scene = ea.getViewElements()
      const edits: ProposalEdits<SceneElement> =
        action === 'accept' ? acceptEdits(scene, proposalId) : dismissEdits(scene, proposalId)
      const touched = [...edits.normalise, ...edits.remove]
      if (touched.length === 0) return false

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
      await ea.addElementsToView(false, true)
      return true
    },

    openViews: () => {
      const views: DrawingView[] = []
      eachLeaf(app, leaf => {
        if (leaf.view.getViewType() === EXCALIDRAW_VIEW) views.push(leaf.view)
      })
      return views
    },

    followRerun: async (from, to, noteFor, on) => {
      const { ea, view } = bind(on)
      const found = rerunScene(ea.getViewElements(), from, to, noteFrontmatter(app, view))
      if (!found) return false
      const notePaths = new Map<SceneElement, string>()
      for (const card of found.cards) {
        const notePath = await noteFor(card.output)
        if (notePath) notePaths.set(card.element, notePath)
      }

      // Bound again: filing the notes gave another action the chance to rebind.
      const { ea: editing } = bind(on)
      editing.copyViewElementsToEAforEditing([...notePaths.keys(), ...found.labels, ...found.frames.map(frame => frame.element)])
      const copy = (element: SceneElement): SceneElement | undefined => editing.getElement(element.id)
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
        if (frame) frame.name = name
      }
      await editing.addElementsToView(false, true)
      return true
    },

    placeRun: async (frame, outputs, on) => {
      const { ea } = bind(on)

      // First, so the panels can name it as their container.
      const frameId = ea.addFrame?.(frame.box.x, frame.box.y, frame.box.width, frame.box.height, frame.name)

      for (const { placed, notePath } of outputs) {
        ea.style.strokeWidth = placed.emphasis ? EMPHASIS_STROKE : PLAIN_STROKE
        const element = embedNote(app, ea, placed.box, notePath)
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
      ea.style.strokeColor = ACCEPTED_STROKE
      // Not repositioned to the cursor: the coordinates are the node's own.
      await ea.addElementsToView(false, true)
      return frameId !== undefined
    },
  }
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
  await ea.addElementsToView(false, true)
  return true
}

/** The drawing a view is showing, as a vault path; `''` when it has no file. */
function drawingPath(view: DrawingView): string {
  return (view as { file?: TFile }).file?.path ?? ''
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
function activeDrawing(app: App): unknown | undefined {
  const leaf = app.workspace.getMostRecentLeaf()
  return leaf?.view.getViewType() === EXCALIDRAW_VIEW ? leaf.view : undefined
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
  app.workspace.iterateAllLeaves(leaf => visit(leaf, (leaf.view as { file?: TFile }).file))
}

/**
 * The drawing's live view: the tab it is already in, or a new one. The view is
 * waited for because `setView` on a half-built one fails silently
 * (`docs/spike-ea.md`).
 */
async function openDrawing(app: App, path: string): Promise<unknown> {
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
  return leaf.view
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
