import { TFile, normalizePath, type App, type FileView, type WorkspaceLeaf } from 'obsidian'
import { drawingChoices, isDrawingPath, type DrawingChoice } from './drawingChoices'
import type { MaybeNodeElement } from './chainNode'
import type { SceneShape } from './nodeScene'
import { cardProposal, type CardProposal } from './runLabel'
import { SelectionClicks } from './selectionClick'
import { DEFAULT_SCRIPT_FOLDER, type ScriptVault } from './toolScript'
import { MINIMUM_VERSION, OLD_EXCALIDRAW, type DrawingView, type ExcalidrawAutomate } from './excalidrawApi'
import { BoundDrawing, embedNote, noteFrontmatter, save } from './boundDrawing'
import { NodeDrawer, type NodeDrawing, type NodeRun, type RunCountMigration } from './nodeDrawing'
import { RunFrameDrawer, type FollowRerun, type RunFrames } from './runFrameDrawing'
import { HoldDrawer, type PickDrawing, type RerunHolds, type RunHold } from './holdDrawing'
import { ProposalDrawer, type ProposalDrawing } from './proposalDrawing'

/**
 * The Excalidraw plugin, as this plugin reaches it (`docs/spike-ea.md`). What is
 * *drawn* is decided by `./drawingChoices` and the caller, not here; how, by each
 * role's own drawer.
 */

export type { DrawingView } from './excalidrawApi'
export { OLD_EXCALIDRAW } from './excalidrawApi'
export { DRAWING_CLOSED } from './boundDrawing'
export type { NodeDrawing, NodeReading } from './nodeDrawing'
export type { PlacedOutput } from './runFrameDrawing'
export type { PickDrawing } from './holdDrawing'
export type { BlockReading, PlacedProposal, ProposalDrawing } from './proposalDrawing'

const PLUGIN_ID = 'obsidian-excalidraw-plugin'

/** The view type Excalidraw registers. A drawing open as markdown is not one. */
const EXCALIDRAW_VIEW = 'excalidraw'

/** The embeddable's starting size; the reader resizes it afterwards. */
const EMBEDDABLE_WIDTH = 400
const EMBEDDABLE_HEIGHT = 300

/** How long to wait for a drawing opened just now to become an Excalidraw view. */
const VIEW_READY_TIMEOUT_MS = 3000
const VIEW_READY_POLL_MS = 50

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

/** Every role starts here: an Excalidraw missing or too old is a notice, not a throw. */
interface Reachable {
  /** Why Excalidraw cannot be used, or `undefined` when it can. */
  unavailable(): string | undefined
}

/**
 * One gesture's drawing: the click's own view, or else the tab in front, bound
 * once. Throws when there is no drawing to bind.
 */
type BindDrawing<Drawing> = (view?: DrawingView) => Drawing

export interface NodeSurface extends Reachable {
  /** Whether the tab in front of the reader is a drawing to put a node on. */
  hasActiveDrawing(): boolean
  on: BindDrawing<NodeDrawing>
}

/** Landing a run on one drawing: its node's status line, its frame and its outputs. */
export interface RunDrawing extends RunCountMigration, NodeRun, RunFrames, RunHold {}

export interface RunSurface extends Reachable {
  on: BindDrawing<RunDrawing>
}

/** Moving one drawing's cards, labels and frames on to a rerun that landed. */
export interface RerunDrawing extends FollowRerun, RerunHolds {}

export interface RerunSurface extends Reachable {
  /** Every drawing open in a view now; a drawing in a tab not yet loaded is not one. */
  openViews(): DrawingView[]
  on: BindDrawing<RerunDrawing>
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

/** Excalidraw, in every role this plugin gives it. */
export type ExcalidrawSurface = NodeSurface & RunSurface & RerunSurface & ProposalSurface & SelectionSurface

/** Said when Expand is asked for and the selection is not one readable block. */
export const SELECT_ONE_BLOCK =
  'Select one text block or embedded note on the drawing to expand it.'

export const NO_EXCALIDRAW =
  'Excalidraw is not installed or not enabled. The drawing surface needs it — install the community plugin.'

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
    return new BoundDrawing(app, ea.getAPI(drawing), drawing)
  }
  const canReroll = (): boolean => options?.canReroll?.() ?? false

  return {
    unavailable: () => unavailableReason(app),
    hasActiveDrawing: () => activeDrawing(app) !== undefined,
    on: view => {
      const drawing = bind(view)
      const nodes: NodeDrawing & NodeRun = new NodeDrawer(drawing)
      const frames: RunFrames & FollowRerun = new RunFrameDrawer(drawing)
      const holds: RunHold & RerunHolds & PickDrawing = new HoldDrawer(drawing, canReroll)
      const proposals: ProposalDrawing = new ProposalDrawer(drawing)
      return combine(nodes, frames, holds, proposals)
    },
    openViews: () => {
      const views: DrawingView[] = []
      eachLeaf(app, leaf => {
        const view = excalidrawView(leaf)
        if (view) views.push(view)
      })
      return views
    },
    selectedRun: () => new RunFrameDrawer(bind()).selectedRun(),
    // Every element a hook hands over is a scene element.
    cardProposal: (element, on) => cardProposal(element as SceneShape, noteFrontmatter(app, on)),
  }
}

type Combined<Roles extends object[]> = Roles extends [infer First, ...infer Rest extends object[]] ? First & Combined<Rest> : unknown

/** One drawing in every role: each role's class methods, bound to the drawer that owns them; an arrow-function property is not one. */
function combine<Roles extends object[]>(...roles: Roles): Combined<Roles> {
  const combined: Record<string, unknown> = {}
  for (const role of roles) {
    for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(role))) {
      const method: unknown = (role as Record<string, unknown>)[name]
      if (name === 'constructor' || typeof method !== 'function') continue
      if (name in combined) throw new Error(`Two drawing roles both define ${name}.`)
      combined[name] = method.bind(role)
    }
  }
  return combined as Combined<Roles>
}

/** Why Excalidraw cannot be used right now, or `undefined` when it can. */
function unavailableReason(app: App): string | undefined {
  const ea = automate(app)
  if (!ea) return NO_EXCALIDRAW
  return ea.verifyMinimumPluginVersion(MINIMUM_VERSION) ? undefined : OLD_EXCALIDRAW
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
