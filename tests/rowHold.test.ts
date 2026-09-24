import { describe, expect, it } from 'vitest'
import { buildHoldColumn, buildPickRow, stampHold, stampPick, type HoldColumn } from '@/ui/holdColumn'
import { roomBelow, rowHold, rowIndex, type RowHold, type SceneBlock } from '@/ui/rowHold'
import { relabel } from '@/ui/runLabel'
import type { HoldRecord } from '@/engine/types'

/** A hold reached inside a pick row, drawn at the row's end without overlapping anything. */

const SOURCE = 'run-source'
const FORK = 'run-fork'
const OTHER = 'run-other'

const firstHold: HoldRecord = {
  nodeId: 'hold-1',
  prompt: 'Pick a direction',
  input: '',
  reachedAt: 'now',
  revision: 1,
  candidates: [
    { heading: 'Meta-Architect', body: 'A short idea.' },
    { heading: 'Echoes', body: 'Another short idea.' },
  ],
}

const secondHold: HoldRecord = {
  nodeId: 'hold-2',
  prompt: 'Pick a world',
  input: '',
  reachedAt: 'later',
  revision: 1,
  candidates: [
    { heading: 'idea a', body: 'The first world.' },
    { heading: 'idea b', body: 'The second world.' },
    { heading: 'idea c', body: 'The third world.' },
  ],
}

let serial = 0
const id = (name: string): string => `${name}-${++serial}`

/** The elements `drawHoldColumn` writes for a column, in frame `frameId`. */
function columnElements(column: HoldColumn, runId: string, nodeId: string, frameId: string): SceneBlock[] {
  const base = { runId, nodeId, heading: '', revision: 1 }
  const elements: SceneBlock[] = [
    { id: id('outline'), type: 'rectangle', ...column.box, frameId, customData: stampHold({ ...base, role: 'column' }) },
    { id: id('prompt'), type: 'text', ...column.prompt.box, frameId, customData: stampHold({ ...base, role: 'column' }) },
  ]
  for (const candidate of column.candidates) {
    const stamp = { ...base, heading: candidate.heading }
    elements.push(
      { id: id('candidate'), type: 'rectangle', ...candidate.box, height: candidate.box.height - 36, frameId, customData: stampHold({ ...stamp, role: 'candidate' }) },
      { id: id('continue'), type: 'text', ...candidate.continueAt, width: 90, height: 20, frameId, customData: stampHold({ ...stamp, role: 'continue' }) },
    )
  }
  elements.push({ id: id('custom'), type: 'rectangle', ...column.custom, frameId, customData: stampHold({ ...base, role: 'column' }) })
  return elements
}

/** The elements `placePickRow` writes beside `candidate` for `indexes`. */
function rowElements(candidate: SceneBlock, runId: string, heading: string, indexes: number[], frameId: string): SceneBlock[] {
  const box = { x: candidate.x!, y: candidate.y!, width: candidate.width!, height: candidate.height! }
  const row = buildPickRow(box, indexes.length)
  const stamp = stampPick({ runId, nodeId: 'hold-1', heading, from: SOURCE })
  const elements: SceneBlock[] = [
    { id: id('tick'), type: 'text', ...row.tick, width: 12, height: 20, frameId, customData: stamp },
    { id: id('heading'), type: 'text', ...row.heading, width: 120, height: 18, frameId, customData: stamp },
  ]
  for (const [along, index] of indexes.entries()) {
    const { box: card, step, length } = row.cards[along]!
    elements.push(
      { id: id('card'), type: 'embeddable', ...card, frameId, customData: { ...stamp, chainRunnerPanel: { runId, index } } },
      { id: id('step'), type: 'text', ...step, width: 80, height: 18, frameId, customData: { ...stamp, chainRunnerPickStep: index } },
      { id: id('count'), type: 'text', ...length, width: 60, height: 18, frameId, customData: { ...stamp, chainRunnerPickCount: index } },
    )
  }
  elements.push({ id: id('direct'), type: 'text', ...row.direct, width: 70, height: 20, frameId, customData: { ...stamp, ...relabel(undefined, runId) } })
  return elements
}

function drawing(): { scene: SceneBlock[]; frame: SceneBlock; lower: SceneBlock; lowerCard: SceneBlock } {
  const frame: SceneBlock = { id: 'frame', type: 'frame', x: 0, y: 0, width: 2000, height: 700 }
  const column = buildHoldColumn(firstHold, 400, 32)
  const scene = [frame, { id: 'reached', type: 'embeddable', x: 32, y: 32, width: 320, height: 160, frameId: 'frame' }]
  scene.push(...columnElements(column, SOURCE, 'hold-1', 'frame'))
  const candidates = scene.filter(element => (element.customData as { chainRunnerHold?: { role?: string } })?.chainRunnerHold?.role === 'candidate')
  scene.push(...rowElements(candidates[0]!, FORK, 'Meta-Architect', [2, 3, 4], 'frame'))
  scene.push(...rowElements(candidates[1]!, OTHER, 'Echoes', [2, 3, 4], 'frame'))
  const lower: SceneBlock = { id: 'lower', type: 'frame', x: 0, y: 780, width: 800, height: 300 }
  const lowerCard: SceneBlock = { id: 'lower-card', type: 'embeddable', x: 32, y: 812, width: 320, height: 160, frameId: 'lower' }
  scene.push(lower, lowerCard, { id: 'aside', type: 'frame', x: 3000, y: 780, width: 400, height: 300 })
  return { scene, frame, lower, lowerCard }
}

const held = (unreached: number[]) => ({ holds: [{ hold: secondHold, pending: [4] }], unreached })
const request = { sourceRunId: SOURCE, runId: FORK, pick: { nodeId: 'hold-1', heading: 'Meta-Architect', pending: [2, 3, 4] }, held: held([3, 4]), canReroll: false }

/** The scene as the write leaves it, with the new column's outline as one more block. */
function applied(scene: readonly SceneBlock[], placed: RowHold): SceneBlock[] {
  const after = scene.filter(element => !placed.removed.includes(element.id)).map(element => {
    const moved = placed.moved.get(element.id)
    const resized = placed.resized.get(element.id)
    return { ...element, x: (element.x ?? 0) + (moved?.dx ?? 0), y: (element.y ?? 0) + (moved?.dy ?? 0), ...resized }
  })
  return [...after, ...placed.columns.map(({ column }, at) => ({ id: `new-column-${at}`, type: 'rectangle', ...column.box, frameId: placed.frameId }))]
}

const overlaps = (one: SceneBlock, other: SceneBlock): boolean =>
  one.x! < other.x! + other.width! && other.x! < one.x! + one.width!
  && one.y! < other.y! + other.height! && other.y! < one.y! + one.height!

/** Blocks that sit beside each other; frames and column outlines hold them. */
function overlappingPairs(scene: readonly SceneBlock[]): Set<string> {
  const leaves = scene.filter(element => element.type !== 'frame'
    && !((element.customData as { chainRunnerHold?: { role?: string } })?.chainRunnerHold?.role === 'column' && element.type === 'rectangle' && element.id.startsWith('outline')))
  const pairs = new Set<string>()
  for (const [at, one] of leaves.entries()) {
    for (const other of leaves.slice(at + 1)) if (overlaps(one, other)) pairs.add([one.id, other.id].sort().join(' & '))
  }
  return pairs
}

describe('a hold reached inside a pick row', () => {
  it('drops the cards the run did not reach and starts the column where the row now ends', () => {
    const { scene } = drawing()
    const placed = rowHold(scene, request)!
    const fork = scene.filter(element => (element.customData as { chainRunnerPick?: { runId?: string } })?.chainRunnerPick?.runId === FORK)
    const unreached = fork.filter(element => [3, 4].includes(rowIndex(element) ?? -1))
    expect(unreached).toHaveLength(6)
    expect(placed.removed.sort()).toEqual(unreached.map(element => element.id).sort())
    const candidate = scene.find(element => element.id.startsWith('candidate'))!
    const kept = buildPickRow({ x: candidate.x!, y: candidate.y!, width: candidate.width!, height: candidate.height! }, 1)
    expect(placed.columns[0]!.column.box).toMatchObject({ x: kept.right, y: candidate.y })
    const direct = fork.find(element => element.id.startsWith('direct'))!
    expect(direct.x! + placed.moved.get(direct.id)!.dx).toBe(kept.direct.x)
    expect(placed.columns[0]!.column.candidates.map(one => one.heading)).toEqual(['idea a', 'idea b', 'idea c'])
  })

  it('moves the rows below down so nothing overlaps, and grows the column and frame around it', () => {
    const { scene, frame, lower, lowerCard } = drawing()
    const placed = rowHold(scene, request)!
    const after = applied(scene, placed)
    const before = overlappingPairs(scene)
    const introduced = [...overlappingPairs(after)].filter(pair => !before.has(pair))
    expect(introduced).toEqual([])

    const echoes = scene.find(element => element.id.startsWith('candidate') && JSON.stringify(element.customData).includes('Echoes'))!
    expect(placed.moved.get(echoes.id)!.dy).toBeGreaterThan(0)
    const reached = after.find(element => element.id === 'reached')!
    expect(reached.y).toBe(32)

    const outline = after.find(element => element.id.startsWith('outline'))!
    const custom = after.find(element => element.id.startsWith('custom'))!
    expect(outline.y! + outline.height!).toBeGreaterThanOrEqual(custom.y! + custom.height!)

    const grown = after.find(element => element.id === frame.id)!
    for (const element of after.filter(one => one.frameId === frame.id)) {
      expect(element.y! + element.height!).toBeLessThanOrEqual(grown.y! + grown.height!)
      expect(element.x! + element.width!).toBeLessThanOrEqual(grown.x! + grown.width!)
    }
    const growth = grown.height! - frame.height!
    expect(placed.moved.get(lower.id)).toEqual({ dx: 0, dy: growth })
    expect(placed.moved.get(lowerCard.id)).toEqual({ dx: 0, dy: growth })
    expect(placed.moved.has('aside')).toBe(false)
  })

  it('draws a row\'s hold once', () => {
    const { scene } = drawing()
    const placed = rowHold(scene, request)!
    const drawn = [...scene, { id: 'nested', type: 'rectangle', ...placed.columns[0]!.column.box, frameId: 'frame', customData: stampHold({ runId: FORK, nodeId: 'hold-2', heading: '', role: 'column' }) }]
    expect(rowHold(drawn, request)).toBeUndefined()
    expect(rowHold(scene, { ...request, pick: { ...request.pick, heading: 'Nowhere' } })).toBeUndefined()
  })

  it('finds the row beside the reader\'s own words once they were picked', () => {
    const { scene } = drawing()
    const own = scene.map(element => {
      const stamp = (element.customData as { chainRunnerHold?: { heading?: string; role?: string } })?.chainRunnerHold
      return stamp?.heading === 'Meta-Architect' && stamp.role === 'candidate'
        ? { ...element, customData: stampHold({ runId: SOURCE, nodeId: 'hold-1', heading: 'Meta-Architect', role: 'custom' }) }
        : element
    })
    const placed = rowHold(own, request)!
    const after = applied(own, placed)
    expect([...overlappingPairs(after)].filter(pair => !overlappingPairs(own).has(pair))).toEqual([])
  })

  it('keeps the row when the hold comes before every card', () => {
    const { scene } = drawing()
    const placed = rowHold(scene, { ...request, held: held([2, 3, 4]) })!
    const candidate = scene.find(element => element.id.startsWith('candidate'))!
    expect(placed.columns[0]!.column.box.x).toBe(buildPickRow({ x: candidate.x!, y: candidate.y!, width: candidate.width!, height: candidate.height! }, 0).right)
    expect(placed.removed).toHaveLength(9)
  })
})

describe('room below a grown column', () => {
  it('moves nothing when the column still ends above what is below', () => {
    const scene: SceneBlock[] = [
      { id: 'frame', type: 'frame', x: 0, y: 0, width: 800, height: 800 },
      { id: 'below', type: 'rectangle', x: 0, y: 600, width: 100, height: 100, frameId: 'frame' },
    ]
    const edits = roomBelow(scene, { frameId: 'frame', from: 300, clear: { x: 0, y: 300, width: 100, height: 200 }, stays: () => false })
    expect(edits.moved.size).toBe(0)
    expect(edits.resized.size).toBe(0)
  })
})
