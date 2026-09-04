import { describe, it, expect } from 'vitest'
import {
  CHAIN_LINK,
  PARAMETER_LINK,
  RUN_LINK,
  UNSET_PARAMETER,
  UNSET_CHAIN,
  buildChainNode,
  chainEdits,
  chainIsUnset,
  chainNodeData,
  chainNodeRole,
  parameterEdits,
  parameterLabel,
  reflowEdits,
} from '@/ui/chainNode'
import type { ChainNodeElement, NodeEdit } from '@/ui/chainNode'
import type { ChainSummary } from '@/engine/types'

/**
 * The node as a set of elements: what it holds, where each piece sits, what
 * survives a reload, and what a rewritten parameter changes. Nothing here
 * touches Excalidraw.
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
    expect(roles(build())).toEqual(['box', 'chain', 'moment', 'parameter', 'run'])
  })

  it('draws the box first, so every line sits on top of it', () => {
    expect(build()[0]?.shape).toBe('rect')
  })

  it('shows the chain name and its moment', () => {
    const elements = build()
    expect(byRole(elements, 'chain').text).toContain('Five Personas')
    expect(byRole(elements, 'moment').text).toBe('“when a premise feels safe”')
  })

  it('falls back to the description when the chain states no moment', () => {
    const elements = build({ moment: undefined, description: 'five personas, one premise' })
    expect(byRole(elements, 'moment').text).toBe('“five personas, one premise”')
  })

  it('leaves the moment line out when the chain says neither', () => {
    expect(roles(build({ moment: undefined, description: undefined }))).toEqual(['box', 'chain', 'parameter', 'run'])
  })

  it('leaves the parameter line out when the chain declares no dropdown', () => {
    expect(roles(build({ parameter: undefined }))).toEqual(['box', 'chain', 'moment', 'run'])
  })

  it('leaves it out when the dropdown has no options to choose between', () => {
    expect(roles(build({ parameter: { name: 'audience', options: [] } }))).toEqual(['box', 'chain', 'moment', 'run'])
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
      ['chain', CHAIN_LINK],
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
    const leftPadding = byRole(elements, 'chain').x - box.x
    expect(run.x).toBeGreaterThan(box.x + box.width / 2)
    expect(box.x + box.width - (run.x + run.width)).toBeCloseTo(leftPadding, 5)
  })

  it('trims a line too long to fit, rather than letting it wrap out of the box', () => {
    const elements = build({ name: 'A'.repeat(200), moment: 'B'.repeat(200) })
    const chainLine = byRole(elements, 'chain')
    const moment = byRole(elements, 'moment')
    expect(chainLine.text?.endsWith('…')).toBe(true)
    expect(moment.text?.endsWith('…')).toBe(true)
    // Still one line each, so the box is the height the builder said it was.
    expect(chainLine.text?.length).toBeLessThan(60)
    expect(moment.text?.length).toBeLessThan(60)
  })

  it('leaves a line that already fits exactly as it is', () => {
    expect(byRole(build(), 'chain').text).toBe('⛓ Five Personas ▾')
  })

  it('draws the moment greyer than the chain line', () => {
    const elements = build()
    expect(byRole(elements, 'moment').strokeColor).not.toBe(byRole(elements, 'chain').strokeColor)
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
    // Both copies claim `n-1`; the re-made group is what tells them apart.
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

describe('a node placed before its chain is picked', () => {
  const blank = (): ChainNodeElement[] => buildChainNode(undefined, { nodeId: 'n-blank' })

  it('holds only the box, the chain line and Run', () => {
    expect(roles(blank())).toEqual(['box', 'chain', 'run'])
  })

  it('says on the chain line that there is a chain to pick', () => {
    expect(byRole(blank(), 'chain').text).toBe(`⛓ ${UNSET_CHAIN} ▾`)
  })

  it('leaves that line clickable, which is the whole point of it', () => {
    expect(byRole(blank(), 'chain').link).toBe(CHAIN_LINK)
  })

  it('reads back as a node with no chain, so a run says so instead of failing', () => {
    const data = chainNodeData(blank()[0])
    expect(data && chainIsUnset(data)).toBe(true)
  })

  it('does not call a node with a chain unset', () => {
    const data = chainNodeData(build()[0])
    expect(data && chainIsUnset(data)).toBe(false)
  })
})

describe('a node drawn before the chain line was clickable', () => {
  it('reads its title line as the chain line', () => {
    expect(chainNodeRole('title')).toBe('chain')
  })

  it('still reads back, so an old node keeps working', () => {
    const stamp = { nodeId: 'n-1', role: 'title', chain: 'five-personas', chainName: 'Five Personas' }
    expect(chainNodeData({ customData: { chainRunner: stamp } })?.role).toBe('title')
  })
})

describe('changing which chain a node runs', () => {
  const relay: ChainSummary = { slug: 'relay', name: 'Relay', moment: 'when an idea is handed on' }
  const bare: ChainSummary = { slug: 'bare', name: 'Bare' }

  /** The node as it sits on a drawing: built at the origin, then moved. */
  const placed = (over: Partial<ChainSummary> = {}, value?: string): ChainNodeElement[] =>
    buildChainNode(chain(over), { nodeId: 'n-1', ...(value ? { parameterValue: value } : {}) }).map(
      (element, index) => ({ ...element, id: `e-${index}`, x: element.x + 100, y: element.y + 40 }),
    )

  const scene = (over: Partial<ChainSummary> = {}, value?: string): ChainNodeElement[] => [
    ...placed(over, value),
    ...buildChainNode(chain({ slug: 'other' }), { nodeId: 'n-2' }),
  ]

  const editText = (reshape: ReturnType<typeof chainEdits<ChainNodeElement>>, role: string): string | undefined =>
    reshape.edits.find(edit => edit.data.role === role)?.text

  it('rewrites the chain line, the moment and the parameter together', () => {
    const reshape = chainEdits(scene({}, 'engineers'), { nodeId: 'n-1' }, relay)
    expect(editText(reshape, 'chain')).toBe('⛓ Relay ▾')
    expect(editText(reshape, 'moment')).toBe('“when an idea is handed on”')
    expect(reshape.removals).toHaveLength(1)
  })

  it('re-stamps every element with the new chain, so a copy of any line runs it', () => {
    const reshape = chainEdits(scene(), { nodeId: 'n-1' }, relay)
    for (const edit of reshape.edits) expect(edit.data).toMatchObject({ chain: 'relay', chainName: 'Relay' })
  })

  it('drops the parameter line when the new chain declares no dropdown', () => {
    const reshape = chainEdits(scene({}, 'engineers'), { nodeId: 'n-1' }, relay)
    const dropped = reshape.removals.map(element => chainNodeData(element)?.role)
    expect(dropped).toEqual(['parameter'])
  })

  it('carries the value the reader picked for the new chain', () => {
    const reshape = chainEdits(scene(), { nodeId: 'n-1' }, chain({ slug: 'again' }), 'founders')
    expect(editText(reshape, 'parameter')).toBe('audience ▾ founders')
  })

  it('draws a line the old chain did not have, at its place on the drawing', () => {
    const reshape = chainEdits(scene({ moment: undefined, description: undefined }), { nodeId: 'n-1' }, relay)
    expect(reshape.additions.map(one => one.role)).toEqual(['moment'])
    const box = reshape.edits.find(edit => edit.data.role === 'box')
    expect(box?.element.x).toBe(100)
    expect(reshape.additions[0]?.x).toBeGreaterThan(100)
    expect(reshape.additions[0]?.y).toBeGreaterThan(40)
  })

  it('keeps the box, so the arrows bound into the node survive the change', () => {
    const reshape = chainEdits(scene(), { nodeId: 'n-1' }, bare)
    expect(reshape.removals.map(element => chainNodeData(element)?.role).sort()).toEqual(['moment', 'parameter'])
    expect(reshape.edits.some(edit => edit.data.role === 'box')).toBe(true)
  })

  it('closes the box up when the node lost lines', () => {
    const tall = chainEdits(scene(), { nodeId: 'n-1' }, chain({ slug: 'again' }))
    const short = chainEdits(scene(), { nodeId: 'n-1' }, bare)
    const height = (reshape: typeof tall): number | undefined =>
      reshape.edits.find(edit => edit.data.role === 'box')?.height
    expect(height(short)).toBeLessThan(height(tall) ?? 0)
  })

  it('moves Run up with the lines above it, and leaves its words to its run', () => {
    const reshape = chainEdits(scene(), { nodeId: 'n-1' }, bare)
    const run = reshape.edits.find(edit => edit.data.role === 'run')
    expect(run?.text).toBeUndefined()
    expect(run?.y).toBeLessThan(placed().find(one => one.role === 'run')?.y ?? 0)
  })

  it('leaves every other node alone', () => {
    const reshape = chainEdits(scene(), { nodeId: 'n-1' }, relay)
    for (const edit of reshape.edits) expect(edit.data.nodeId).toBe('n-1')
    expect(reshape.removals.every(element => chainNodeData(element)?.nodeId === 'n-1')).toBe(true)
  })

  it('touches nothing when the node is no longer on the drawing', () => {
    expect(chainEdits(scene(), { nodeId: 'n-gone' }, relay)).toEqual({ edits: [], additions: [], removals: [] })
  })
})

describe('re-cutting a node the reader resized', () => {
  const long = chain({
    name: 'A chain whose name is far too long to sit in a three-hundred-pixel box',
    moment: 'when the sentence explaining the moment runs on well past what the box can hold',
  })

  /** The node on a drawing, its box dragged to `width`. */
  const resized = (width: number, value = 'engineers'): ChainNodeElement[] =>
    buildChainNode(long, { nodeId: 'n-1', parameterValue: value }).map((element, index) => ({
      ...element,
      id: `e-${index}`,
      ...(element.role === 'box' ? { width } : {}),
    }))

  const edit = (elements: ChainNodeElement[], role: string): NodeEdit<ChainNodeElement> | undefined =>
    reflowEdits(elements, { nodeId: 'n-1' }).find(one => one.data.role === role)

  it('does nothing while the box is still the width its lines were cut for', () => {
    expect(reflowEdits(resized(300), { nodeId: 'n-1' })).toEqual([])
  })

  it('shows more of the chain name when the box is dragged wider', () => {
    const before = byRole(resized(300), 'chain').text ?? ''
    const after = edit(resized(600), 'chain')?.text ?? ''
    expect(after.length).toBeGreaterThan(before.length)
    expect(after).toContain('A chain whose name is far too long')
  })

  it('shows more of the moment too, which the node is the only record of', () => {
    const before = byRole(resized(300), 'moment').text ?? ''
    const after = edit(resized(600), 'moment')?.text ?? ''
    expect(after.length).toBeGreaterThan(before.length)
    expect(after).toContain('when the sentence explaining the moment')
  })

  it('cuts back down when the box is dragged narrower', () => {
    const wide = edit(resized(600), 'chain')?.text ?? ''
    const narrow = edit(resized(200), 'chain')?.text ?? ''
    expect(narrow.length).toBeLessThan(wide.length)
    expect(narrow.endsWith('…')).toBe(true)
  })

  it('puts the type size back, so a dragged node reads at the size it was designed at', () => {
    const scaled = resized(600).map(element =>
      element.role === 'chain' ? { ...element, fontSize: 44 } : element,
    )
    expect(reflowEdits(scaled, { nodeId: 'n-1' }).find(one => one.data.role === 'chain')?.fontSize).toBe(20)
  })

  it('keeps the lines inside the box it was given', () => {
    const chainLine = edit(resized(600), 'chain')
    expect(chainLine?.width).toBe(600 - 14 * 2)
  })

  it('keeps ▶ Run against the box’s right edge', () => {
    const run = edit(resized(600), 'run')
    const width = byRole(resized(600), 'run').width
    expect(run?.x).toBe(600 - 14 - width)
  })

  it('leaves the ▶ Run line’s words alone: they belong to the run, not the box', () => {
    // Rewriting them would put `▶ Run` back over a run that is still going.
    expect(edit(resized(600), 'run')?.text).toBeUndefined()
  })

  it('closes the box around the lines it now holds', () => {
    const box = edit(resized(600), 'box')
    expect(box?.height).toBeGreaterThan(0)
    expect(box?.data.laidOut).toBe(600)
  })

  it('records the new width on every element, so one re-cut is not repeated', () => {
    const done = reflowEdits(resized(600), { nodeId: 'n-1' }).map(one => ({
      ...one.element,
      ...(one.data.role === 'box' ? { width: 600 } : {}),
      customData: { chainRunner: one.data },
    }))
    expect(reflowEdits(done, { nodeId: 'n-1' })).toEqual([])
  })

  it('leaves other nodes on the drawing alone', () => {
    const other = buildChainNode(chain({ slug: 'other' }), { nodeId: 'n-2' })
    const edits = reflowEdits([...resized(600), ...other], { nodeId: 'n-1' })
    expect(edits.every(one => one.data.nodeId === 'n-1')).toBe(true)
  })

  it('says nothing about a node that is not on the drawing', () => {
    expect(reflowEdits(resized(600), { nodeId: 'gone' })).toEqual([])
  })

  it('re-cuts a node drawn before the words were kept, from what it still shows', () => {
    // An older node carries no `moment`, so its own line is all there is to cut.
    const older = resized(600).map(element => ({
      ...element,
      customData: { chainRunner: { ...chainNodeData(element)!, moment: undefined } },
    }))
    const moment = reflowEdits(older, { nodeId: 'n-1' }).find(one => one.data.role === 'moment')
    expect(moment?.text).toBe(byRole(resized(300), 'moment').text)
  })
})
