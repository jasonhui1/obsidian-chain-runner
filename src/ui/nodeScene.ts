import { chainNodeData, nodeElementData, type MaybeNodeElement, type NodeTarget } from './chainNode'

/**
 * What the drawing tells a chain node about itself: what is bound into it, and
 * where it sits.
 *
 * A node's inputs are not stored anywhere — they are the arrows the reader drew,
 * read off the scene each time Run is clicked. That is the whole point of the
 * surface: the drawing is the document, and moving an arrow changes what the
 * next run reads with nothing to re-save.
 *
 * Everything here is a pure function of a scene, so the reading — which arrows
 * count, what each source contributes, what order they come in — is checkable
 * without Excalidraw. `src/ui/excalidraw.ts` is the only thing that hands it a
 * real scene.
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
 * One thing bound into a node. A text element carries its words; an embeddable
 * carries a note, which only the vault can read — so the link is passed on
 * rather than resolved here.
 */
export type NodeInput = { kind: 'text'; text: string } | { kind: 'note'; linkpath: string }

export interface NodeInputs {
  /** In reading order: top of the drawing to the bottom of it. */
  inputs: NodeInput[]
  /**
   * Arrows into the node whose far end says nothing — bound to nothing, to an
   * element that has since been deleted, to a web page, or to an empty shape.
   * Counted rather than dropped silently: a reader who drew an arrow expects it
   * to have arrived.
   */
  unbound: number
}

/** A rectangle on the drawing, in the scene's own coordinates. */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Where a node sits, from its box element — the one element of the five whose
 * size is the node's size.
 *
 * `undefined` means the node is no longer on this drawing, which is what a click
 * arriving after a delete looks like.
 */
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
 * What is bound into a node, in the order a reader would read it.
 *
 * Only arrows *ending* on the node count. An arrow drawn the other way points at
 * something the node feeds, and treating it as an input would make the direction
 * the reader drew mean nothing.
 *
 * Order is top-to-bottom by where each source sits, not the order the arrows
 * were drawn: the drawing is what the reader sees, and two inputs swap places by
 * being dragged past each other rather than by being redrawn.
 */
export function resolveInputs(scene: readonly SceneShape[], target: NodeTarget): NodeInputs {
  const byId = new Map(scene.map(element => [element.id, element]))
  const ours = new Set(scene.filter(element => nodeElementData(element, target)).map(element => element.id))

  const sources: SceneShape[] = []
  let unbound = 0
  for (const element of scene) {
    if (element.type !== 'arrow') continue
    if (!ours.has(element.endBinding?.elementId ?? '')) continue
    const source = byId.get(element.startBinding?.elementId ?? '')
    // An arrow from one node into another is a shape this ticket does not read;
    // it is counted as unbound rather than pasted in as the other node's title.
    if (!source || ours.has(source.id) || chainNodeData(source)) {
      unbound++
      continue
    }
    sources.push(source)
  }

  const inputs: NodeInput[] = []
  for (const source of sources.sort(topToBottom)) {
    const input = readSource(source, scene)
    if (input) inputs.push(input)
    else unbound++
  }
  return { inputs, unbound }
}

/** Reading order on a drawing. `x` and the id only break ties, so it is stable. */
function topToBottom(left: SceneShape, right: SceneShape): number {
  return (left.y ?? 0) - (right.y ?? 0) || (left.x ?? 0) - (right.x ?? 0) || left.id.localeCompare(right.id)
}

/**
 * What one bound element contributes. A shape with text bound inside it — the
 * ordinary way a reader writes a note to themselves on a drawing — contributes
 * that text, so a labelled rectangle works as well as a bare text element.
 */
function readSource(source: SceneShape, scene: readonly SceneShape[]): NodeInput | undefined {
  if (source.type === 'embeddable' || source.type === 'iframe') {
    const linkpath = linkpathOf(source.link)
    return linkpath ? { kind: 'note', linkpath } : undefined
  }
  const text = textOf(source) ?? boundText(source, scene)
  return text ? { kind: 'text', text } : undefined
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
 * The note an embeddable shows, or `undefined` when it shows something the vault
 * has no body for.
 *
 * Excalidraw writes a file embeddable's link as a wiki link, and the reader may
 * have pointed one at a heading or given it an alias — both name the same note,
 * and the whole of it is what the chain is given.
 */
function linkpathOf(link: string | null | undefined): string | undefined {
  if (!link) return undefined
  const wiki = /^\[\[(.+)\]\]$/.exec(link.trim())
  const raw = (wiki ? wiki[1] : link.trim()).trim()
  // A web page is a perfectly good thing to put on a drawing, and nothing this
  // plugin can read as a seed.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return undefined
  const withoutAlias = raw.split('|')[0] ?? ''
  const note = (withoutAlias.split('#')[0] ?? '').trim()
  return note === '' ? undefined : note
}
