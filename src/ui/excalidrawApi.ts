import type { TFile } from 'obsidian'
import type { SceneShape } from './nodeScene'
import type { SelectedIds } from './selectionClick'

/** Every call below predates 2.0; verified against 2.26.4 (`docs/spike-ea.md`). */
export const MINIMUM_VERSION = '2.0.0'

export const OLD_EXCALIDRAW = `This Excalidraw is too old for Chain Runner; update it to ${MINIMUM_VERSION} or newer.`

/**
 * A live Excalidraw view. A click carries its own, the only handle on a drawing
 * embedded in a note; Obsidian's `FileView` is one.
 */
export interface DrawingView {
  readonly file: TFile | null
}

/**
 * The slice of ExcalidrawAutomate this plugin calls. Typed rather than imported:
 * an import would make an optional plugin a build dependency.
 */
export interface ExcalidrawAutomate {
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
export interface SceneElement extends SceneShape {
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
