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

/** EA's link-click hook; returning `false` stops the link opening (`docs/spike-ea.md`, Q1). */
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
  note: TFile
}

/** What the chain-node actions need a drawing to do. */
export interface NodeSurface {
  /** Why Excalidraw cannot be used, or `undefined` when it can. */
  unavailable(): string | undefined
  /** Whether the tab in front of the reader is a drawing to put a node on. */
  hasActiveDrawing(): boolean
  /** Puts a built node on that drawing, at the cursor, and saves. */
  place(elements: ChainNodeElement[]): Promise<void>
  /** Rewrites a node's parameter in place. `false` means the node is no longer there. */
  setParameter(target: NodeTarget, value: string, on?: DrawingView): Promise<boolean>
  /** What a node is bound to and where it sits; `undefined` when it is gone. */
  read(target: NodeTarget, on?: DrawingView): NodeReading | undefined
  /** Rewrites the node's `▶ Run` line. `false` means the node is no longer there. */
  setRunStatus(target: NodeTarget, status: NodeRunStatus, on?: DrawingView): Promise<boolean>
  /** `false` means no frame could be made and the outputs landed loose. */
  placeRun(frame: RunFrame, outputs: readonly PlacedOutput[], on?: DrawingView): Promise<boolean>
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
        // Newest-first, and may name deleted files; `drawingChoices` drops those.
        recent: app.workspace.getLastOpenFiles(),
      }),
    place: async (drawing, note) => {
      const ea = automate(app)
      if (!ea) throw new Error(NO_EXCALIDRAW)
      const view = await openDrawing(app, drawing.path)
      ea.reset()
      // The binding goes stale when the reader switches tabs, so it is set per call.
      ea.setView(view)
      embedNote(ea, { x: 0, y: 0, width: EMBEDDABLE_WIDTH, height: EMBEDDABLE_HEIGHT }, note)
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

    place: async elements => {
      const { ea } = bind()
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

    placeRun: async (frame, outputs, on) => {
      const { ea } = bind(on)

      // First, so the panels can name it as their container.
      const frameId = ea.addFrame?.(frame.box.x, frame.box.y, frame.box.width, frame.box.height, frame.name)

      for (const { placed, note } of outputs) {
        ea.style.strokeWidth = placed.emphasis ? EMPHASIS_STROKE : PLAIN_STROKE
        const element = embedNote(ea, placed.box, note)
        // A scripted element has to claim its frame; only a drop is worked out.
        if (element && frameId) element.frameId = frameId
      }
      ea.style.strokeWidth = PLAIN_STROKE
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
function embedNote(ea: ExcalidrawAutomate, box: Box, note: TFile): SceneElement | undefined {
  const id = ea.addEmbeddable(box.x, box.y, box.width, box.height, undefined, note)
  const element = ea.getElement(id)
  if (element && !element.link) element.link = `[[${note.path}]]`
  return element
}

/** Outputs the layout is about are drawn heavier. */
const EMPHASIS_STROKE = 4
const PLAIN_STROKE = 1

/** `false` means the node was deleted between the click and the write. */
async function write(ea: ExcalidrawAutomate, edits: NodeEdit<SceneElement>[]): Promise<boolean> {
  if (edits.length === 0) return false
  // The copies keep their ids, so writing them back updates the node in place.
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

/** The drawing in front of the reader, or `undefined` when the tab is something else. */
function activeDrawing(app: App): unknown | undefined {
  const leaf = app.workspace.getMostRecentLeaf()
  return leaf?.view.getViewType() === EXCALIDRAW_VIEW ? leaf.view : undefined
}

function automate(app: App): ExcalidrawAutomate | undefined {
  // Through the plugin instance, not the window global, to keep the dependency
  // explicit (`docs/spike-ea.md`).
  const plugins = (app as unknown as { plugins?: { plugins?: Record<string, { ea?: ExcalidrawAutomate }> } }).plugins
  return plugins?.plugins?.[PLUGIN_ID]?.ea
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
