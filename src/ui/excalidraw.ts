import { TFile, type App, type WorkspaceLeaf } from 'obsidian'
import { drawingChoices, isDrawingPath, type DrawingChoice } from './drawingChoices'
import { parameterEdits, type ChainNodeElement, type MaybeNodeElement, type NodeTarget } from './chainNode'

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
  fontSize: number
  textAlign: string
}

interface TextFormatting {
  width?: number
  textAlign?: string
}

/** An element on the scene, narrowed to the fields a chain node reads or writes. */
interface SceneElement extends MaybeNodeElement {
  id: string
  type: string
  link?: string | null
  text?: string
  /** What Excalidraw re-wraps from; a text element edited without it snaps back. */
  originalText?: string
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

/** What the chain-node actions need a drawing to do. */
export interface NodeSurface {
  /** Why Excalidraw cannot be used, or `undefined` when it can. */
  unavailable(): string | undefined
  /** Whether the tab in front of the reader is a drawing to put a node on. */
  hasActiveDrawing(): boolean
  /** Puts a built node on that drawing, at the cursor, and saves. */
  place(elements: ChainNodeElement[]): Promise<void>
  /**
   * Rewrites a node's parameter where it stands. `false` means the node is no
   * longer on the drawing — deleted, or on a drawing that is no longer in front.
   */
  setParameter(target: NodeTarget, value: string): Promise<boolean>
}

export const NO_EXCALIDRAW =
  'Excalidraw is not installed or not enabled. The drawing surface needs it — install the community plugin.'
export const OLD_EXCALIDRAW = `This Excalidraw is too old for Chain Runner; update it to ${MINIMUM_VERSION} or newer.`

export function createDrawingSurface(app: App): DrawingSurface {
  return {
    unavailable: () => {
      const ea = automate(app)
      if (!ea) return NO_EXCALIDRAW
      return ea.verifyMinimumPluginVersion(MINIMUM_VERSION) ? undefined : OLD_EXCALIDRAW
    },
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

/** Said when a chain-node action runs with something other than a drawing in front. */
export const NOT_A_DRAWING = 'The drawing this node was on is no longer the tab in front.'

export function createNodeSurface(app: App): NodeSurface {
  /** The one place a node action reaches Excalidraw: the handle, bound to the tab in front. */
  const bind = (): ExcalidrawAutomate => {
    const ea = automate(app)
    if (!ea) throw new Error(NO_EXCALIDRAW)
    const view = activeDrawing(app)
    if (!view) throw new Error(NOT_A_DRAWING)
    ea.reset()
    // The binding goes stale whenever the reader switches tabs, so it is set at
    // the entry point on every call rather than once at startup.
    ea.setView(view)
    return ea
  }

  return {
    unavailable: () => {
      const ea = automate(app)
      if (!ea) return NO_EXCALIDRAW
      return ea.verifyMinimumPluginVersion(MINIMUM_VERSION) ? undefined : OLD_EXCALIDRAW
    },

    hasActiveDrawing: () => activeDrawing(app) !== undefined,

    place: async elements => {
      const ea = bind()
      const ids = elements.map(element => draw(ea, element))
      // One group, so the five elements move, copy and delete as the one node
      // they read as. The reader can still ungroup it; it is their drawing.
      if (ids.length > 1) ea.addToGroup(ids)
      // Reposition to the cursor: the reader put it where they want the node.
      await ea.addElementsToView(true, true)
    },

    setParameter: async (target, value) => {
      const ea = bind()
      const edits = parameterEdits(ea.getViewElements(), target, value)
      if (edits.length === 0) return false
      // Editing in place rather than adding: the copies keep their ids, so
      // writing them back updates the node instead of drawing a second one.
      ea.copyViewElementsToEAforEditing(edits.map(edit => edit.element))
      for (const edit of edits) {
        const element = ea.getElement(edit.element.id)
        if (!element) continue
        element.customData = { chainRunner: edit.data }
        if (edit.text === undefined) continue
        element.text = edit.text
        // Excalidraw re-wraps from `originalText`; setting only `text` snaps back.
        element.originalText = edit.text
        ea.refreshTextElementSize?.(element.id)
      }
      await ea.addElementsToView(false, true)
      return true
    },
  }
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
export function registerLinkHook(app: App, handler: (element: MaybeNodeElement) => boolean): () => void {
  const ea = automate(app)
  if (!ea) return () => {}
  const previous = ea.onLinkClickHook
  ea.onLinkClickHook = (element, linkText, event, view, self) => {
    if (!handler(element)) return false
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
