import { describe, it, expect } from 'vitest'
import {
  PARAMETER_LINK,
  RUN_LINK,
  UNSET_PARAMETER,
  buildChainNode,
  chainNodeData,
  parameterEdits,
  parameterLabel,
} from '@/ui/chainNode'
import type { ChainNodeElement } from '@/ui/chainNode'
import type { ChainSummary } from '@/engine/types'

/**
 * The node as a set of elements: what it holds, where each piece sits, what
 * survives a reload, and what a rewritten parameter changes.
 *
 * Nothing here touches Excalidraw. The builder answers in plain shapes, so the
 * whole of the node's shape is checkable without a drawing; `src/ui/excalidraw.ts`
 * is the only thing that turns these into elements on a scene.
 */

const chain = (over: Partial<ChainSummary> = {}): ChainSummary => ({
  slug: 'five-personas',
  name: 'Five Personas',
  moment: 'when a premise feels safe',
  parameter: { name: 'audience', options: ['engineers', 'founders'] },
  ...over,
})

const build = (over: Partial<ChainSummary> = {}, parameterValue?: string): ChainNodeElement[] =>
  buildChainNode(chain(over), { nodeId: 'n-1', parameterValue })

const roles = (elements: ChainNodeElement[]): string[] => elements.map(element => element.role)

function byRole(elements: ChainNodeElement[], role: string): ChainNodeElement {
  const found = elements.find(element => element.role === role)
  if (!found) throw new Error(`no ${role} in the node`)
  return found
}

describe('building a chain node', () => {
  it('holds a box, the title, the moment, the parameter and Run', () => {
    expect(roles(build())).toEqual(['box', 'title', 'moment', 'parameter', 'run'])
  })

  it('draws the box first, so every line sits on top of it', () => {
    expect(build()[0]?.shape).toBe('rect')
  })

  it('shows the chain name and its moment', () => {
    const elements = build()
    expect(byRole(elements, 'title').text).toContain('Five Personas')
    expect(byRole(elements, 'moment').text).toBe('“when a premise feels safe”')
  })

  it('falls back to the description when the chain states no moment', () => {
    const elements = build({ moment: undefined, description: 'five personas, one premise' })
    expect(byRole(elements, 'moment').text).toBe('“five personas, one premise”')
  })

  it('leaves the moment line out when the chain says neither', () => {
    expect(roles(build({ moment: undefined, description: undefined }))).toEqual(['box', 'title', 'parameter', 'run'])
  })

  it('leaves the parameter line out when the chain declares no dropdown', () => {
    expect(roles(build({ parameter: undefined }))).toEqual(['box', 'title', 'moment', 'run'])
  })

  it('leaves it out when the dropdown has no options to choose between', () => {
    expect(roles(build({ parameter: { name: 'audience', options: [] } }))).toEqual(['box', 'title', 'moment', 'run'])
  })

  it('reads the parameter as name, marker and value', () => {
    expect(byRole(build({}, 'engineers'), 'parameter').text).toBe('audience ▾ engineers')
  })

  it('says the value is unset rather than trailing off', () => {
    expect(byRole(build(), 'parameter').text).toBe(`audience ▾ ${UNSET_PARAMETER}`)
  })

  it('links only the two lines a click means something on', () => {
    expect(build().map(element => [element.role, element.link])).toEqual([
      ['box', undefined],
      ['title', undefined],
      ['moment', undefined],
      ['parameter', PARAMETER_LINK],
      ['run', RUN_LINK],
    ])
  })

  it('keeps every line inside the box', () => {
    const elements = build()
    const box = byRole(elements, 'box')
    for (const element of elements.filter(one => one.role !== 'box')) {
      expect(element.x).toBeGreaterThanOrEqual(box.x)
      expect(element.y).toBeGreaterThanOrEqual(box.y)
      expect(element.x + element.width).toBeLessThanOrEqual(box.x + box.width)
      expect(element.y + element.height).toBeLessThanOrEqual(box.y + box.height)
    }
  })

  it('stacks the lines down the box in reading order', () => {
    const tops = build()
      .filter(element => element.role !== 'box')
      .map(element => element.y)
    expect([...tops].sort((a, b) => a - b)).toEqual(tops)
  })

  it('puts Run against the right edge, where the screen puts it', () => {
    const elements = build()
    const box = byRole(elements, 'box')
    const run = byRole(elements, 'run')
    const leftPadding = byRole(elements, 'title').x - box.x
    expect(run.x).toBeGreaterThan(box.x + box.width / 2)
    expect(box.x + box.width - (run.x + run.width)).toBeCloseTo(leftPadding, 5)
  })

  it('trims a line too long to fit, rather than letting it wrap out of the box', () => {
    const elements = build({ name: 'A'.repeat(200), moment: 'B'.repeat(200) })
    const title = byRole(elements, 'title')
    const moment = byRole(elements, 'moment')
    expect(title.text?.endsWith('…')).toBe(true)
    expect(moment.text?.endsWith('…')).toBe(true)
    // Still one line each, so the box is the height the builder said it was.
    expect(title.text?.length).toBeLessThan(60)
    expect(moment.text?.length).toBeLessThan(60)
  })

  it('leaves a line that already fits exactly as it is', () => {
    expect(byRole(build(), 'title').text).toBe('⛓ Five Personas')
  })

  it('draws the moment greyer than the title', () => {
    const elements = build()
    expect(byRole(elements, 'moment').strokeColor).not.toBe(byRole(elements, 'title').strokeColor)
  })

  it('places the node at the origin, so the drawing decides where it lands', () => {
    expect(byRole(build(), 'box')).toMatchObject({ x: 0, y: 0 })
  })
})

describe('what the node stores on its elements', () => {
  it('stamps every element with the same node, chain and value', () => {
    for (const element of build({}, 'engineers')) {
      expect(element.customData.chainRunner).toMatchObject({
        nodeId: 'n-1',
        chain: 'five-personas',
        chainName: 'Five Personas',
        parameterName: 'audience',
        parameterValue: 'engineers',
      })
    }
  })

  it('records each element own part, so a click knows what was clicked', () => {
    const elements = build()
    expect(elements.map(element => element.customData.chainRunner.role)).toEqual(roles(elements))
  })

  it('reads its own stamp back off an element', () => {
    expect(chainNodeData(build()[0])?.nodeId).toBe('n-1')
  })

  it('does not claim an element that is not a chain node', () => {
    expect(chainNodeData({ customData: { other: {} } })).toBeUndefined()
    expect(chainNodeData({})).toBeUndefined()
    expect(chainNodeData({ customData: { chainRunner: { role: 'run' } } })).toBeUndefined()
  })
})

describe('rewriting the parameter in place', () => {
  const scene = (): ChainNodeElement[] => [
    ...build({}, 'engineers'),
    ...buildChainNode(chain({ slug: 'other' }), { nodeId: 'n-2', parameterValue: 'founders' }),
  ]

  it('changes the parameter line text', () => {
    const edits = parameterEdits(scene(), { nodeId: 'n-1' }, 'founders')
    expect(edits.find(edit => edit.data.role === 'parameter')?.text).toBe('audience ▾ founders')
  })

  it('re-stamps every element of that node, so a copy of any of them carries the value', () => {
    const edits = parameterEdits(scene(), { nodeId: 'n-1' }, 'founders')
    expect(edits).toHaveLength(5)
    for (const edit of edits) expect(edit.data.parameterValue).toBe('founders')
  })

  it('leaves every other node alone', () => {
    for (const edit of parameterEdits(scene(), { nodeId: 'n-1' }, 'founders')) expect(edit.data.nodeId).toBe('n-1')
  })

  it('touches nothing when the node is no longer on the drawing', () => {
    expect(parameterEdits(scene(), { nodeId: 'n-gone' }, 'founders')).toEqual([])
  })

  it('rewrites only the copy of the node that was clicked', () => {
    const grouped = (nodeId: string, group: string): ChainNodeElement[] =>
      buildChainNode(chain(), { nodeId, parameterValue: 'engineers' }).map(element => ({
        ...element,
        groupIds: [group],
      }))
    // Copying a node copies its `customData` too, so both copies claim `n-1`;
    // Excalidraw re-makes the group, and that is what tells them apart.
    const copies = [...grouped('n-1', 'g-first'), ...grouped('n-1', 'g-copy')]

    const edits = parameterEdits(copies, { nodeId: 'n-1', groupIds: ['g-copy'] }, 'founders')
    expect(edits).toHaveLength(5)
    for (const edit of edits) expect(edit.element.groupIds).toEqual(['g-copy'])
  })

  it('still rewrites an element the reader has ungrouped from its node', () => {
    const [box, ...rest] = build({}, 'engineers').map(element => ({ ...element, groupIds: ['g-first'] }))
    const loose = { ...(box as ChainNodeElement), groupIds: [] as string[] }
    const edits = parameterEdits([loose, ...rest], { nodeId: 'n-1', groupIds: ['g-first'] }, 'founders')
    expect(edits).toHaveLength(5)
  })

  it('changes the text only on the line that shows the value', () => {
    const changed = parameterEdits(scene(), { nodeId: 'n-1' }, 'founders').filter(edit => edit.text !== undefined)
    expect(changed.map(edit => edit.data.role)).toEqual(['parameter'])
  })
})

describe('the parameter label', () => {
  it('reads name, marker, value', () => {
    expect(parameterLabel('audience', 'engineers')).toBe('audience ▾ engineers')
  })

  it('says unset rather than trailing off', () => {
    expect(parameterLabel('audience', undefined)).toBe(`audience ▾ ${UNSET_PARAMETER}`)
  })
})
