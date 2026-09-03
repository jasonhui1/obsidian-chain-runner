import { TFile, type App, type WorkspaceLeaf } from 'obsidian'
import { drawingChoices, isDrawingPath, type DrawingChoice } from './drawingChoices'
import {
  parameterEdits,
  runEdits,
  type ChainNodeElement,
  type MaybeNodeElement,
  type NodeEdit,
  type NodeRunStatus,
  type NodeTarget,
} from './chainNode'
import { nodeBox, resolveInputs, type Box, type NodeInputs, type SceneShape } from './nodeScene'
import type { RunFrame } from '../run/runFrame'

/**
 * The Excalidraw plugin, as this plugin reaches it.
 *
 * Everything here is a fact about the other plugin — its id, its minimum
 * version, the calls the spike found work (`docs/spike-ea.md`) — kept in one
 * file so a change on their side is a change in one place on ours. What is
 * *drawn* is not decided here; that is `./drawingChoices` and the caller.
 */

const PLUGIN_ID = 'obsidian-excalidraw-plugin'

/** The view type Excalidraw registers. A drawing open as markdown is not one. */
const EXCALIDRAW_VIEW = 'excalidraw'

/**
 * Every call below predates 2.0, so this excludes the 1.x line without
 * excluding anyone on a current release. Verified against 2.26.4; raise it
 * rather than lower it if a 2.x user reports trouble (`docs/spike-ea.md`).
 */
const MINIMUM_VERSION = '2.0.0'

/** The embeddable's size on the drawing. The reader resizes it afterwards; they own it. */
const EMBEDDABLE_WIDTH = 400
const EMBEDDABLE_HEIGHT = 300

/** How long to wait for a drawing opened just now to become an Excalidraw view. */
const VIEW_READY_TIMEOUT_MS = 3000
const VIEW_READY_POLL_MS = 50

/**
 * The slice of ExcalidrawAutomate this plugin calls. Typed here rather than
 * imported: Excalidraw is a runtime dependency reached through `app.plugins`,
 * and a compile-time import would make an optional plugin a build dependency.
 */
interface ExcalidrawAutomate {
  verifyMinimumPluginVersion(version: string): boolean
  reset(): void
  setView(view: unknown): void
  style: ElementStyle
  addEmbeddable(x: number, y: number, width: number, height: number, url?: string, file?: TFile): string
  addRect(x: number, y: number, width: number, height: number): string
  /**
   * Excalidraw's own frame. Feature-detected rather than required: the spike
   * verified the four `add*` calls below and not this one, and a drawing is
   * better off with a labelled rectangle than with nothing.
   */
  addFrame?(x: number, y: number, width: number, height: number, name?: string): string
  addText(x: number, y: number, text: string, formatting?: TextFormatting): string
  getElement(id: string): SceneElement | undefined
  getViewElements(): SceneElement[]
  /** Puts existing scene elements on the workbench, ids kept, so a write updates them. */
  copyViewElementsToEAforEditing(elements: SceneElement[]): void
  addToGroup(elementIds: string[]): string
  /** Re-measures a text element after its text changed; a no-op on older builds. */
  refreshTextElementSize?(id: string): void
  addElementsToView(repositionToCursor?: boolean, save?: boolean): Promise<boolean>
  onLinkClickHook?: LinkClickHook
}

/** EA's element defaults, set before each `add*` call rather than passed to it. */
interface ElementStyle {
  strokeColor: string
  backgroundColor: string
  strokeWidth: number
  fontSize: number
  textAlign: string
}

interface TextFormatting {
  width?: number
  textAlign?: string
}

/** An element on the scene, narrowed to the fields a chain node reads or writes. */
interface SceneElement extends SceneShape {
  /** The frame this element belongs to. Excalidraw assigns it on drop; we assign it on place. */
  frameId?: string | null
}

/**
 * The hook a link click goes through, in EA's own positional shape. Returning
 * `false` stops Excalidraw opening the link (`docs/spike-ea.md`, Q1).
 */
type LinkClickHook = (
  element: SceneElement,
  linkText: string,
  event: unknown,
  view: unknown,
  ea: unknown,
) => boolean

/** What the "send to drawing" action needs a drawing surface to do. */
export interface DrawingSurface {
  /** Why the surface cannot be used, or `undefined` when it can. */
  unavailable(): string | undefined
  /** The drawings to offer, in the order to offer them. */
  choices(): DrawingChoice[]
  /** Puts `note` on `drawing` as an embeddable at the cursor, and saves. */
  place(drawing: DrawingChoice, note: TFile): Promise<void>
}

/**
 * A live Excalidraw view, as this plugin passes one around: opaque, because the
 * only thing done with it is handing it back to `setView`. A click arrives with
 * the view it happened in, which is the only way to reach a drawing embedded in
 * a note — that one is not a tab, so it can never be found by looking at tabs.
 */
export type DrawingView = unknown

/** What a node's drawing says about it, at the moment it was asked. */
export interface NodeReading {
  /** Where the node sits, which is what its run's frame is placed against. */
  box: Box
  /** What is bound into it, in reading order. */
  inputs: NodeInputs
  /** The drawing's own path, which is what a wiki link on it resolves against. */
  drawing: string
}

/** What the chain-node actions need a drawing to do. */
export interface NodeSurface {
  /** Why Excalidraw cannot be used, or `undefined` when it can. */
  unavailable(): string | undefined
  /** Whether the tab in front of the reader is a drawing to put a node on. */
  hasActiveDrawing(): boolean
  /** Puts a built node on that drawing, at the cursor, and saves. */
  place(elements: ChainNodeElement[]): Promise<void>
  /**
   * Rewrites a node's parameter where it stands, on `on` when a click named the
   * view it happened in. `false` means the node is no longer there.
   */
  setParameter(target: NodeTarget, value: string, on?: DrawingView): Promise<boolean>
  /** What a node is bound to and where it sits; `undefined` when it is gone. */
  read(target: NodeTarget, on?: DrawingView): NodeReading | undefined
  /** Rewrites the node's `▶ Run` line. `false` means the node is no longer there. */
  setRunStatus(target: NodeTarget, status: NodeRunStatus, on?: DrawingView): Promise<boolean>
  /**
   * Puts a run's outputs on the drawing: a frame, and one embeddable per panel
   * showing the note at the same index. A panel whose note could not be written
   * is left out rather than drawn empty.
   */
  placeRun(frame: RunFrame, notes: readonly (TFile | undefined)[], on?: DrawingView): Promise<void>
}

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
        // Obsidian's recent list is newest-first and holds paths of files that
        // may since have been deleted; `drawingChoices` drops what the vault
        // no longer has.
        recent: app.workspace.getLastOpenFiles(),
      }),
    place: async (drawing, note) => {
      const ea = automate(app)
      if (!ea) throw new Error(NO_EXCALIDRAW)
      const view = await openDrawing(app, drawing.path)
      ea.reset()
      // The binding goes stale whenever the reader switches tabs, so it is set
      // at the entry point on every call rather than once at startup.
      ea.setView(view)
      ea.addEmbeddable(0, 0, EMBEDDABLE_WIDTH, EMBEDDABLE_HEIGHT, undefined, note)
      // Reposition to the cursor, and save: the reader put the cursor where they
      // want the note, and a drawing that loses the piece on reload kept nothing.
      await ea.addElementsToView(true, true)
    },
  }
}

/** Said when a chain-node action cannot find the drawing it is meant to act on. */
export const NOT_A_DRAWING = 'Open the Excalidraw drawing as its own tab to do that.'

export function createNodeSurface(app: App): NodeSurface {
  /**
   * The one place a node action reaches Excalidraw: the handle, bound to a view.
   *
   * A click hands over the view it happened in, and that one is used in
   * preference to the tab in front — a drawing embedded in a note is not a tab,
   * so looking for one would refuse a click that plainly arrived from a drawing.
   */
  const bind = (on?: DrawingView): { ea: ExcalidrawAutomate; view: DrawingView } => {
    const ea = automate(app)
    if (!ea) throw new Error(NO_EXCALIDRAW)
    const view = on ?? activeDrawing(app)
    if (!view) throw new Error(NOT_A_DRAWING)
    ea.reset()
    // The binding goes stale whenever the reader switches tabs, so it is set at
    // the entry point on every call rather than once at startup.
    ea.setView(view)
    return { ea, view }
  }

  return {
    unavailable: () => unavailableReason(app),

    hasActiveDrawing: () => activeDrawing(app) !== undefined,

    place: async elements => {
      const { ea } = bind()
      const ids = elements.map(element => draw(ea, element))
      // One group, so the five elements move, copy and delete as the one node
      // they read as. The reader can still ungroup it; it is their drawing.
      if (ids.length > 1) ea.addToGroup(ids)
      // Reposition to the cursor: the reader put it where they want the node.
      await ea.addElementsToView(true, true)
    },

    setParameter: async (target, value, on) => {
      const { ea } = bind(on)
      return write(ea, parameterEdits(ea.getViewElements(), target, value))
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
      return { box, inputs: resolveInputs(scene, target), drawing: drawingPath(view) }
    },

    placeRun: async (frame, notes, on) => {
      const { ea } = bind(on)
      const held = frame.panels
        .map((placed, index) => ({ placed, note: notes[index] }))
        .filter((one): one is { placed: (typeof frame.panels)[number]; note: TFile } => one.note !== undefined)

      // The frame comes first so the panels can name it as their container; an
      // Excalidraw that cannot make one gets a labelled rectangle instead, which
      // says the same thing and holds nothing.
      const frameId = ea.addFrame
        ? ea.addFrame(frame.box.x, frame.box.y, frame.box.width, frame.box.height, frame.name)
        : drawFallbackFrame(ea, frame)

      for (const { placed, note } of held) {
        ea.style.strokeWidth = placed.emphasis ? EMPHASIS_STROKE : PLAIN_STROKE
        const { box } = placed
        const id = ea.addEmbeddable(box.x, box.y, box.width, box.height, undefined, note)
        const element = ea.getElement(id)
        // Excalidraw works out frame membership when a reader drops something in
        // one; an element placed by a script has to say so itself. Without this
        // the panels would sit over the frame rather than in it, and dragging the
        // frame would leave them behind.
        if (element && ea.addFrame) element.frameId = frameId
      }
      ea.style.strokeWidth = PLAIN_STROKE
      // Not repositioned to the cursor: the coordinates are the node's own, and
      // a run's outputs belong beside the node that produced them.
      await ea.addElementsToView(false, true)
    },
  }
}

/** A run's outputs are drawn heavier when they are what the layout is about. */
const EMPHASIS_STROKE = 4
const PLAIN_STROKE = 1

/** Room above a fallback frame's rectangle for its title. */
const FRAME_TITLE_GAP = 28

/**
 * The frame, for an Excalidraw with no `addFrame`: a rectangle and its title.
 *
 * It holds nothing — dragging it moves a rectangle and leaves the panels — but a
 * run's outputs are still grouped, named and readable, which is the part a
 * reader is looking at.
 */
function drawFallbackFrame(ea: ExcalidrawAutomate, frame: RunFrame): string {
  ea.style.strokeColor = FRAME_INK
  ea.style.backgroundColor = 'transparent'
  ea.style.strokeWidth = PLAIN_STROKE
  const id = ea.addRect(frame.box.x, frame.box.y, frame.box.width, frame.box.height)
  ea.addText(frame.box.x, frame.box.y - FRAME_TITLE_GAP, frame.name, { width: frame.box.width })
  return id
}

/** Excalidraw's own grey, for a frame that is a container and not a drawing of one. */
const FRAME_INK = '#868e96'

/**
 * Writes edits back to the node they came from. `false` means there was nothing
 * to write to, which is what a node deleted between the click and the write
 * looks like.
 */
async function write(ea: ExcalidrawAutomate, edits: NodeEdit<SceneElement>[]): Promise<boolean> {
  if (edits.length === 0) return false
  // Editing in place rather than adding: the copies keep their ids, so
  // writing them back updates the node instead of drawing a second one.
  ea.copyViewElementsToEAforEditing(edits.map(edit => edit.element))
  for (const edit of edits) {
    const element = ea.getElement(edit.element.id)
    if (!element) continue
    element.customData = { chainRunner: edit.data }
    if (edit.text === undefined) continue
    const wasWide = element.width ?? 0
    element.text = edit.text
    // Excalidraw re-wraps from `originalText`; setting only `text` snaps back.
    element.originalText = edit.text
    ea.refreshTextElementSize?.(element.id)
    // The `▶ Run` line is set against the box's right edge, so a label that grew
    // has to move left by what it gained rather than out through the box.
    if (edit.keepRightEdge) element.x = (element.x ?? 0) + wasWide - (element.width ?? 0)
  }
  await ea.addElementsToView(false, true)
  return true
}

/** The drawing a view is showing, as a vault path; `''` when it has no file. */
function drawingPath(view: DrawingView): string {
  return (view as { file?: TFile }).file?.path ?? ''
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
  const id =
    element.shape === 'rect'
      ? drawRect(ea, element)
      : ea.addText(element.x, element.y, element.text ?? '', {
          width: element.width,
          textAlign: element.textAlign ?? 'left',
        })
  const made = ea.getElement(id)
  if (made) {
    // A link is what makes a line clickable at all; the click is recognised by
    // `customData`, which is also what survives a move, a copy and a reload.
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
 * Intercepts link clicks so a chain node's own links never open anything.
 *
 * Anything the handler does not claim falls through to whatever hook was already
 * installed, and the returned function puts that hook back. EA holds one hook,
 * so a plugin that installs its own after this one wins until it unloads.
 */
export function registerLinkHook(
  app: App,
  handler: (element: MaybeNodeElement, view: DrawingView) => boolean,
): () => void {
  const ea = automate(app)
  if (!ea) return () => {}
  const previous = ea.onLinkClickHook
  ea.onLinkClickHook = (element, linkText, event, view, self) => {
    // The view the click happened in goes to the handler: it is the only handle
    // on a drawing embedded in a note, which is not a tab and cannot be found.
    if (!handler(element, view)) return false
    return previous ? previous(element, linkText, event, view, self) : true
  }
  return () => {
    ea.onLinkClickHook = previous
  }
}

/** The drawing in front of the reader, or `undefined` when the tab is something else. */
function activeDrawing(app: App): unknown | undefined {
  const leaf = app.workspace.getMostRecentLeaf()
  return leaf?.view.getViewType() === EXCALIDRAW_VIEW ? leaf.view : undefined
}

function automate(app: App): ExcalidrawAutomate | undefined {
  // Reached through the plugin instance rather than the window global: both
  // exist, and this one keeps the dependency explicit (`docs/spike-ea.md`).
  const plugins = (app as unknown as { plugins?: { plugins?: Record<string, { ea?: ExcalidrawAutomate }> } }).plugins
  return plugins?.plugins?.[PLUGIN_ID]?.ea
}

/**
 * Whether a file is a drawing. The path answers for both of Excalidraw's file
 * shapes; an ordinary note marked as a drawing in its frontmatter can only be
 * recognised through the metadata cache, so both are asked.
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

/**
 * Every leaf and the file it holds. The cast is the one place this plugin
 * assumes a view knows its file, which not every view does — so it is made once,
 * here, rather than at each walk.
 */
function eachLeaf(app: App, visit: (leaf: WorkspaceLeaf, file: TFile | undefined) => void): void {
  app.workspace.iterateAllLeaves(leaf => visit(leaf, (leaf.view as { file?: TFile }).file))
}

/**
 * The drawing's live view: the tab it is already in, or a new one.
 *
 * A drawing opened just now is not an Excalidraw view yet — the plugin builds it
 * a beat later, and `setView` on the half-built one fails silently, drawing
 * nothing (`docs/spike-ea.md`). So the view is waited for rather than assumed.
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
 * The Excalidraw tab showing this drawing, if there is one.
 *
 * The view type is part of the match, not just the path: a `.excalidraw.md` can
 * also be open as a plain markdown tab, and EA cannot be pointed at that one.
 * Answering with it would wait out the readiness loop and then refuse a drawing
 * that opens perfectly well in a tab of its own.
 */
function leafShowing(app: App, path: string): WorkspaceLeaf | undefined {
  let found: WorkspaceLeaf | undefined
  eachLeaf(app, (leaf, file) => {
    if (!found && file?.path === path && leaf.view.getViewType() === EXCALIDRAW_VIEW) found = leaf
  })
  return found
}
