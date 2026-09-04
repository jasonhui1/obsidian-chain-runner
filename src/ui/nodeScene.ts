import { chainNodeData, nodeElementData, type MaybeNodeElement, type NodeTarget } from './chainNode'

/**
 * What a node reads off its drawing: the arrows bound into it, and where it
 * sits. Pure, so it is checkable without Excalidraw.
 */

/** An element on the scene, narrowed to what a node's reading looks at. */
export interface SceneShape extends MaybeNodeElement {
  id: string
  type: string
  x?: number
  y?: number
  width?: number
  height?: number
  text?: string
  /** What Excalidraw re-wraps a text element from; the unwrapped truth. */
  originalText?: string
  /** Set on a text element bound inside a container, naming the container. */
  containerId?: string | null
  link?: string | null
  startBinding?: { elementId?: string } | null
  endBinding?: { elementId?: string } | null
}

/**
 * The vault path of the markdown note an `image` element draws, or `undefined`
 * for a picture. Only the surface can answer, so the reading is given it.
 */
export type ImageNoteLookup = (element: SceneShape) => string | undefined

/** An embeddable carries a note only the vault can read, so the link is passed on. */
export type NodeInput = { kind: 'text'; text: string } | { kind: 'note'; linkpath: string }

export interface NodeInputs {
  /** Top of the drawing to the bottom of it. */
  inputs: NodeInput[]
  /** Arrows whose far end says nothing. Counted, so the reader can be told. */
  unbound: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Where a node sits; `undefined` once it is off the drawing. */
export function nodeBox(scene: readonly SceneShape[], target: NodeTarget): Box | undefined {
  for (const element of scene) {
    const data = nodeElementData(element, target)
    if (data?.role !== 'box') continue
    return {
      x: element.x ?? 0,
      y: element.y ?? 0,
      width: element.width ?? 0,
      height: element.height ?? 0,
    }
  }
  return undefined
}

/**
 * What is bound into a node. Only arrows *ending* on it count — one drawn the
 * other way points at something the node feeds. Ordered by where each source
 * sits, so inputs reorder by being dragged rather than redrawn.
 */
export function resolveInputs(
  scene: readonly SceneShape[],
  target: NodeTarget,
  imageNote: ImageNoteLookup,
): NodeInputs {
  const byId = new Map(scene.map(element => [element.id, element]))
  const ours = new Set(scene.filter(element => nodeElementData(element, target)).map(element => element.id))

  const sources: SceneShape[] = []
  let unbound = 0
  for (const element of scene) {
    if (element.type !== 'arrow') continue
    if (!ours.has(element.endBinding?.elementId ?? '')) continue
    const source = byId.get(element.startBinding?.elementId ?? '')
    // One node feeding another is not read; counted rather than pasted in.
    if (!source || ours.has(source.id) || chainNodeData(source)) {
      unbound++
      continue
    }
    sources.push(source)
  }

  const inputs: NodeInput[] = []
  for (const source of sources.sort(topToBottom)) {
    const input = blockInput(source, scene, imageNote)
    if (input) inputs.push(input)
    else unbound++
  }
  return { inputs, unbound }
}

/** `x` and the id only break ties, so the order is stable. */
function topToBottom(left: SceneShape, right: SceneShape): number {
  return (left.y ?? 0) - (right.y ?? 0) || (left.x ?? 0) - (right.x ?? 0) || left.id.localeCompare(right.id)
}

/**
 * What one block on the drawing contributes: its own words, the words bound
 * inside it, or the note it embeds. A labelled shape contributes its bound text,
 * as a bare text element does.
 */
export function blockInput(
  source: SceneShape,
  scene: readonly SceneShape[],
  imageNote: ImageNoteLookup,
): NodeInput | undefined {
  if (source.type === 'embeddable' || source.type === 'iframe') return noteInput(linkpathOf(source.link))
  if (source.type === 'image') return noteInput(imageNote(source))
  const text = textOf(source) ?? boundText(source, scene)
  return text ? { kind: 'text', text } : undefined
}

function noteInput(linkpath: string | undefined): NodeInput | undefined {
  return linkpath ? { kind: 'note', linkpath } : undefined
}

function textOf(element: SceneShape): string | undefined {
  const text = (element.originalText ?? element.text ?? '').trim()
  return text === '' ? undefined : text
}

function boundText(container: SceneShape, scene: readonly SceneShape[]): string | undefined {
  for (const element of scene) {
    if (element.containerId === container.id) return textOf(element)
  }
  return undefined
}

/**
 * The note an embeddable shows. An alias or a heading names the same note, and
 * the whole of it is what the chain is given; a web page is not a note.
 */
function linkpathOf(link: string | null | undefined): string | undefined {
  if (!link) return undefined
  const wiki = /^\[\[(.+)\]\]$/.exec(link.trim())
  const raw = (wiki ? wiki[1] : link.trim()).trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return undefined
  const withoutAlias = raw.split('|')[0] ?? ''
  const note = (withoutAlias.split('#')[0] ?? '').trim()
  return note === '' ? undefined : note
}
