import { describe, expect, it } from 'vitest'
import { buildPickRow, nextOwnWordsCard, ownWordsHeight, stampHold, stampPick, OWN_WORDS_PLACEHOLDER } from '@/ui/holdColumn'
import { pickRow, pickRowDrawn, type SceneBlock } from '@/ui/rowHold'
import { FRAME_PADDING } from '@/run/runFrame'

/** Where a first pick's row lands beside its card, worked out from the scene alone. */

const SOURCE = 'run-source'
const FORK = 'run-fork'
const hold = { runId: SOURCE, nodeId: 'hold-1', heading: '' }

function drawing(): SceneBlock[] {
  return [
    { id: 'frame', type: 'frame', x: 0, y: 0, width: 800, height: 700 },
    { id: 'column', type: 'rectangle', x: 400, y: 32, width: 360, height: 600, frameId: 'frame', customData: stampHold({ ...hold, role: 'column' }) },
    { id: 'idea', type: 'rectangle', x: 416, y: 100, width: 328, height: 124, frameId: 'frame', customData: stampHold({ ...hold, heading: 'Echoes', role: 'candidate' }) },
    { id: 'own', type: 'rectangle', x: 416, y: 400, width: 328, height: 124, frameId: 'frame', customData: stampHold({ ...hold, role: 'custom' }) },
    { id: 'own-words', type: 'text', x: 428, y: 412, width: 300, height: 20, containerId: 'own', frameId: 'frame', originalText: OWN_WORDS_PLACEHOLDER, customData: stampHold({ ...hold, role: 'custom' }) },
    { id: 'own-continue', type: 'text', x: 432, y: 524, width: 90, height: 20, frameId: 'frame', customData: stampHold({ ...hold, role: 'continue', custom: true }) },
    { id: 'reroll', type: 'text', x: 416, y: 600, width: 90, height: 20, frameId: 'frame', customData: stampHold({ ...hold, role: 'reroll' }) },
  ]
}

const byId = (scene: readonly SceneBlock[], id: string): SceneBlock => scene.find(element => element.id === id)!
const request = { runId: FORK, from: [SOURCE], pick: { nodeId: 'hold-1', heading: 'Echoes', pending: [2, 3] }, count: 2 }

describe('a first pick\'s row', () => {
  it('sits beside its candidate, takes the reroll away and widens the frame to fit', () => {
    const scene = drawing()
    const plan = pickRow(scene, request)!
    const idea = byId(scene, 'idea')
    const row = buildPickRow({ x: idea.x!, y: idea.y!, width: idea.width!, height: idea.height! }, 2)
    expect(plan.candidate).toBe('idea')
    expect(plan.row).toEqual(row)
    expect(plan.frameId).toBe('frame')
    expect(plan.removed).toEqual(['reroll'])
    expect(plan.resized.get('frame')).toEqual({ width: row.right + 32 })
    expect(plan.touched).toEqual(['idea', 'frame', 'reroll'])
    expect(plan.ownWords).toBeUndefined()
  })

  it('is not drawn twice, and needs its card on the scene', () => {
    const scene = drawing()
    expect(pickRowDrawn(scene, FORK, request.pick)).toBe(false)
    const drawn = [...scene, { id: 'tick', type: 'text', customData: stampPick({ runId: FORK, nodeId: 'hold-1', heading: 'Echoes', from: SOURCE }) }]
    expect(pickRowDrawn(drawn, FORK, request.pick)).toBe(true)
    expect(pickRow(scene, { ...request, pick: { ...request.pick, heading: 'Nowhere' } })).toBeUndefined()
  })

  it('keeps the reader\'s own words on their card and leaves an empty one below', () => {
    const scene = drawing()
    const words = 'A theme park on the moon.'
    const plan = pickRow(scene, { ...request, pick: { ...request.pick, heading: 'A theme park on the moon.', words } })!
    const own = byId(scene, 'own')
    const box = { x: own.x!, y: own.y!, width: own.width!, height: own.height! }
    const used = { ...box, height: ownWordsHeight(box, words) }
    const next = nextOwnWordsCard(used)
    expect(plan.candidate).toBe('own')
    expect(plan.removed).toEqual(['reroll', 'own-continue'])
    expect(plan.ownWords).toEqual({ wordsId: 'own-words', text: words, next })
    expect(plan.resized.get('own')).toEqual({ height: used.height })
    expect(plan.resized.get('column')).toEqual({ height: Math.max(600, next.columnBottom - 32) })
    expect(plan.resized.get('frame')?.height).toBe(Math.max(700, next.columnBottom + FRAME_PADDING))
  })

  it('leaves own words already on the card as they are', () => {
    const scene = drawing().map(element => element.id === 'own-words' ? { ...element, originalText: 'Typed already' } : element)
    const plan = pickRow(scene, { ...request, pick: { ...request.pick, heading: 'Typed already', words: 'Typed already' } })!
    expect(plan.ownWords).toEqual({ wordsId: 'own-words', next: nextOwnWordsCard({ x: 416, y: 400, width: 328, height: 124 }) })
    expect(plan.resized.has('own')).toBe(false)
  })
})
