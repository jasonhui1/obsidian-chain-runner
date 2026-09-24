import { TFile, type App } from 'obsidian'
import type { Box, ImageNoteLookup } from './nodeScene'
import type { NoteFrontmatter } from './runLabel'
import type { SceneEdits } from './rowHold'
import { OLD_EXCALIDRAW, type DrawingView, type ExcalidrawAutomate, type SceneElement } from './excalidrawApi'

/** What every drawing role shares: one drawing, its EA instance, and the scene helpers they write with. */

/**
 * One drawing, bound once for one gesture. Its own EA instance rather than the
 * shared one, whose binding any other action or tab can move while this one awaits.
 */
export class BoundDrawing {
  constructor(
    readonly app: App,
    readonly ea: ExcalidrawAutomate,
    readonly view: DrawingView,
  ) {}

  /** The instance, its workbench emptied so a write carries only its own elements. */
  emptied(): ExcalidrawAutomate {
    this.ea.reset()
    return this.ea
  }
}

/** Said when a gesture's drawing was closed before it could be written to. */
export const DRAWING_CLOSED = 'That drawing was closed, so nothing was written to it.'

/** Writes the workbench to the view and saves; `repositionToCursor` for what lands at the cursor. */
export async function save(ea: ExcalidrawAutomate, repositionToCursor: boolean): Promise<void> {
  // `false` is Excalidraw's word for a view that has unloaded since it was bound.
  if (!(await ea.addElementsToView(repositionToCursor, true))) throw new Error(DRAWING_CLOSED)
}

/** Copies what `edits` touches onto the workbench and changes it there, for the one save that follows. */
export function applyEdits(ea: ExcalidrawAutomate, scene: readonly SceneElement[], edits: SceneEdits): void {
  const touched = new Set([...edits.removed, ...edits.moved.keys(), ...edits.resized.keys()])
  if (touched.size === 0) return
  ea.copyViewElementsToEAforEditing(scene.filter(element => touched.has(element.id)))
  editCopies(ea, edits)
}

/** Changes the copies already on the workbench as `edits` says. */
export function editCopies(ea: ExcalidrawAutomate, edits: SceneEdits): void {
  for (const id of edits.removed) {
    const copy = ea.getElement(id)
    if (copy) copy.isDeleted = true
  }
  for (const [id, { dx, dy }] of edits.moved) {
    const copy = ea.getElement(id)
    if (!copy) continue
    copy.x = (copy.x ?? 0) + dx
    copy.y = (copy.y ?? 0) + dy
  }
  for (const [id, size] of edits.resized) {
    const copy = ea.getElement(id)
    if (!copy) continue
    if (size.width !== undefined) copy.width = size.width
    if (size.height !== undefined) copy.height = size.height
  }
}

/**
 * A note on the scene. The link is what an arrow out of the embeddable reads it
 * back by (`./nodeScene.ts`), so it is set here rather than left to Excalidraw's
 * own bookkeeping — which is how an output becomes the next run's input.
 */
export function embedNote(app: App, ea: ExcalidrawAutomate, box: Box, notePath: string): SceneElement | undefined {
  // Gone since it was written: the rest of the scene still lands.
  const note = app.vault.getAbstractFileByPath(notePath)
  if (!(note instanceof TFile)) return undefined
  const id = ea.addEmbeddable(box.x, box.y, box.width, box.height, undefined, note)
  const element = ea.getElement(id)
  if (element && !element.link) element.link = `[[${note.path}]]`
  return element
}

/**
 * The note an image element draws. `Insert file from vault` renders a note as an
 * image whose file is Excalidraw's own bookkeeping, not a link we can read; only
 * a markdown note has a body to read, so a picture is not one.
 */
export function imageNoteLookup(ea: ExcalidrawAutomate): ImageNoteLookup {
  return element => {
    // An Excalidraw that cannot say is too old to read an image at all.
    if (!ea.getViewFileForImageElement) throw new Error(OLD_EXCALIDRAW)
    const note = ea.getViewFileForImageElement(element)
    return note && note.extension === 'md' ? note.path : undefined
  }
}

export function isElement(element: SceneElement | undefined): element is SceneElement {
  return element !== undefined
}

/** What the reader has selected; an Excalidraw that cannot say is too old to expand on. */
export function selectedElements(ea: ExcalidrawAutomate): SceneElement[] {
  if (!ea.getViewSelectedElements) throw new Error(OLD_EXCALIDRAW)
  return ea.getViewSelectedElements()
}

/** The drawing a view is showing, as a vault path; `''` when it has no file. */
export function drawingPath(view: DrawingView): string {
  return view.file?.path ?? ''
}

/** A linked note's frontmatter, resolving the link from the drawing it sits on. */
export function noteFrontmatter(app: App, view: DrawingView): NoteFrontmatter {
  const drawing = drawingPath(view)
  return linkpath => {
    const note = app.metadataCache.getFirstLinkpathDest(linkpath, drawing)
    return note ? app.metadataCache.getFileCache(note)?.frontmatter : undefined
  }
}
