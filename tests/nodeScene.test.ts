import { describe, it, expect } from 'vitest'
import { nodeBox, nodeRunCount, resolveInputs, type SceneShape } from '@/ui/nodeScene'
import { buildChainNode, chainNodeData } from '@/ui/chainNode'
import type { ChainSummary } from '@/engine/types'

/** What a node reads off its drawing; the scene is the only input. */

const chain: ChainSummary = { slug: 'relay', name: 'Relay', moment: 'when an idea needs handing on' }

const target = { nodeId: 'n-1', groupIds: ['g-1'] }

/** The node as it sits on a scene: its elements, grouped and given ids. */
function nodeElements(): SceneShape[] {
  return buildChainNode(chain, { nodeId: 'n-1' }).map((element, index) => ({
    id: `node-${index}`,
    type: element.shape === 'rect' ? 'rectangle' : 'text',
    x: 600 + element.x,
    y: 400 + element.y,
    width: element.width,
    height: element.height,
    ...(element.text ? { text: element.text, originalText: element.text } : {}),
    groupIds: ['g-1'],
    customData: element.customData,
  }))
}

describe('the stored run count', () => {
  it('reads the value shown on the node', () => {
    const scene = nodeElements().map(element =>
      chainNodeData(element)?.role === 'run-count' ? { ...element, text: '3', originalText: '3' } : element,
    )
    expect(nodeRunCount(scene, target)).toBe('3')
  })

  it('lets an older node default to one', () => {
    const scene = nodeElements().filter(element => {
      const role = chainNodeData(element)?.role
      return role !== 'run-count' && role !== 'run-count-box'
    })
    expect(nodeRunCount(scene, target)).toBeUndefined()
  })
})

const arrow = (id: string, from: string | undefined, to: string): SceneShape => ({
  id,
  type: 'arrow',
  ...(from ? { startBinding: { elementId: from } } : {}),
  endBinding: { elementId: to },
})

const text = (id: string, words: string, y: number): SceneShape => ({
  id,
  type: 'text',
  x: 0,
  y,
  originalText: words,
  text: words,
})

const embeddable = (id: string, link: string, y: number): SceneShape => ({
  id,
  type: 'embeddable',
  x: 0,
  y,
  link,
})

/** What `Insert file from vault` draws: the file is nowhere on the element. */
const image = (id: string, y: number): SceneShape => ({ id, type: 'image', x: 0, y })

/** Stands in for the vault: an image element's markdown note, by element id. */
const notes =
  (byId: Record<string, string>) =>
  (element: SceneShape): string | undefined =>
    byId[element.id]

/** The node's box, which is what an arrow the reader drew lands on. */
const BOX = 'node-0'

describe('nodeBox', () => {
  it('is where the box element sits', () => {
    expect(nodeBox(nodeElements(), target)).toEqual({ x: 600, y: 400, width: 300, height: expect.any(Number) })
  })

  it('is undefined once the node has been deleted', () => {
    expect(nodeBox([], target)).toBeUndefined()
  })

  it('is undefined for a copy of the node that is not the one clicked', () => {
    expect(nodeBox(nodeElements(), { nodeId: 'n-1', groupIds: ['g-other'] })).toBeUndefined()
  })
})

describe('resolveInputs', () => {
  it('reads a text element bound in as its words', () => {
    const scene = [...nodeElements(), text('t1', 'a premise', 100), arrow('a1', 't1', BOX)]
    expect(resolveInputs(scene, target, notes({}))).toEqual({ inputs: [{ kind: 'text', text: 'a premise' }], unbound: 0 })
  })

  it('reads an output of an earlier run as the note it is', () => {
    const output = embeddable('e1', '[[chains/runs/2026-09-02-ab12c/Survivor.md]]', 100)
    expect(resolveInputs([...nodeElements(), output, arrow('a1', 'e1', BOX)], target, notes({}))).toEqual({
      inputs: [{ kind: 'note', linkpath: 'chains/runs/2026-09-02-ab12c/Survivor.md' }],
      unbound: 0,
    })
  })

  it('reads an embeddable bound in as the note it shows', () => {
    const scene = [...nodeElements(), embeddable('e1', '[[notes/premise.md]]', 100), arrow('a1', 'e1', BOX)]
    expect(resolveInputs(scene, target, notes({}))).toEqual({
      inputs: [{ kind: 'note', linkpath: 'notes/premise.md' }],
      unbound: 0,
    })
  })

  it('reads a note inserted from the vault as the note it draws', () => {
    const scene = [...nodeElements(), image('i1', 100), arrow('a1', 'i1', BOX)]
    expect(resolveInputs(scene, target, notes({ i1: 'notes/premise.md' }))).toEqual({
      inputs: [{ kind: 'note', linkpath: 'notes/premise.md' }],
      unbound: 0,
    })
  })

  it('orders a note inserted from the vault with the rest, top to bottom', () => {
    const scene = [
      ...nodeElements(),
      image('i1', 300),
      text('t1', 'first', 100),
      arrow('a1', 'i1', BOX),
      arrow('a2', 't1', BOX),
    ]
    expect(resolveInputs(scene, target, notes({ i1: 'notes/premise.md' })).inputs).toEqual([
      { kind: 'text', text: 'first' },
      { kind: 'note', linkpath: 'notes/premise.md' },
    ])
  })

  it('counts a picture as unbound, since it has no body to read', () => {
    const scene = [...nodeElements(), image('i1', 100), arrow('a1', 'i1', BOX)]
    expect(resolveInputs(scene, target, notes({}))).toEqual({ inputs: [], unbound: 1 })
  })

  it('takes the note out of an aliased link to a heading', () => {
    const scene = [...nodeElements(), embeddable('e1', '[[premise#Middle|the middle]]', 100), arrow('a1', 'e1', BOX)]
    expect(resolveInputs(scene, target, notes({})).inputs).toEqual([{ kind: 'note', linkpath: 'premise' }])
  })

  it('orders inputs top to bottom, not by the order the arrows were drawn', () => {
    const scene = [
      ...nodeElements(),
      text('lower', 'second', 300),
      text('upper', 'first', 100),
      arrow('a1', 'lower', BOX),
      arrow('a2', 'upper', BOX),
    ]
    expect(resolveInputs(scene, target, notes({})).inputs).toEqual([
      { kind: 'text', text: 'first' },
      { kind: 'text', text: 'second' },
    ])
  })

  it('mixes text and notes in the same reading order', () => {
    const scene = [
      ...nodeElements(),
      embeddable('e1', '[[premise]]', 300),
      text('t1', 'and also', 100),
      arrow('a1', 'e1', BOX),
      arrow('a2', 't1', BOX),
    ]
    expect(resolveInputs(scene, target, notes({})).inputs).toEqual([
      { kind: 'text', text: 'and also' },
      { kind: 'note', linkpath: 'premise' },
    ])
  })

  it('reads the text bound inside a labelled shape', () => {
    const scene: SceneShape[] = [
      ...nodeElements(),
      { id: 'r1', type: 'rectangle', x: 0, y: 100, width: 100, height: 50 },
      { id: 'r1-text', type: 'text', containerId: 'r1', originalText: 'in a box' },
      arrow('a1', 'r1', BOX),
    ]
    expect(resolveInputs(scene, target, notes({})).inputs).toEqual([{ kind: 'text', text: 'in a box' }])
  })

  it('counts an arrow bound to nothing as unbound', () => {
    const scene = [...nodeElements(), arrow('a1', undefined, BOX)]
    expect(resolveInputs(scene, target, notes({}))).toEqual({ inputs: [], unbound: 1 })
  })

  it('counts an arrow from something deleted as unbound', () => {
    const scene = [...nodeElements(), arrow('a1', 'gone', BOX)]
    expect(resolveInputs(scene, target, notes({})).unbound).toBe(1)
  })

  it('counts an empty shape and a web page as unbound', () => {
    const scene: SceneShape[] = [
      ...nodeElements(),
      { id: 'r1', type: 'rectangle', x: 0, y: 100 },
      embeddable('e1', 'https://example.com', 200),
      arrow('a1', 'r1', BOX),
      arrow('a2', 'e1', BOX),
    ]
    expect(resolveInputs(scene, target, notes({}))).toEqual({ inputs: [], unbound: 2 })
  })

  it('keeps what it could read alongside what it could not', () => {
    const scene = [...nodeElements(), text('t1', 'a premise', 100), arrow('a1', 't1', BOX), arrow('a2', undefined, BOX)]
    expect(resolveInputs(scene, target, notes({}))).toEqual({ inputs: [{ kind: 'text', text: 'a premise' }], unbound: 1 })
  })

  it('ignores an arrow pointing out of the node', () => {
    const scene = [...nodeElements(), text('t1', 'downstream', 100), arrow('a1', BOX, 't1')]
    expect(resolveInputs(scene, target, notes({}))).toEqual({ inputs: [], unbound: 0 })
  })

  it('ignores arrows into another copy of the node', () => {
    const other = nodeElements().map(element => ({ ...element, id: `${element.id}-copy`, groupIds: ['g-2'] }))
    const scene = [...nodeElements(), ...other, text('t1', 'theirs', 100), arrow('a1', 't1', 'node-0-copy')]
    expect(resolveInputs(scene, target, notes({}))).toEqual({ inputs: [], unbound: 0 })
  })

  it('counts an arrow from one chain node into another as unbound', () => {
    const other = nodeElements().map(element => ({ ...element, id: `${element.id}-copy`, groupIds: ['g-2'] }))
    const scene = [...nodeElements(), ...other, arrow('a1', 'node-0-copy', BOX)]
    expect(resolveInputs(scene, target, notes({}))).toEqual({ inputs: [], unbound: 1 })
  })

  it('reads an arrow bound to any line of the node, not only its box', () => {
    const scene = [...nodeElements(), text('t1', 'a premise', 100), arrow('a1', 't1', 'node-1')]
    expect(resolveInputs(scene, target, notes({})).inputs).toEqual([{ kind: 'text', text: 'a premise' }])
  })
})
