import { describe, expect, it } from 'vitest'
import { TFile, type App } from 'obsidian'
import { createExcalidrawSurface, type DrawingView, type RerunDrawing, type RunDrawing } from '@/ui/excalidraw'
import { holdStamp } from '@/ui/holdColumn'
import type { HoldRecord, LayoutPanel } from '@/engine/types'
import type { RunFrame } from '@/run/runFrame'
import type { RerunLanding } from '@/run/rerunWatch'

/** A hold reached inside a pick row, drawn on a drawing with a fake Excalidraw: one save, nothing on top of anything. */

interface FakeElement {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  text?: string
  originalText?: string
  rawText?: string
  link?: string | null
  customData?: unknown
  containerId?: string | null
  frameId?: string | null
  name?: string | null
  strokeStyle?: string
  isDeleted?: boolean
}

function drawing(): { app: App; elements: FakeElement[]; view: DrawingView; saves: () => number } {
  const elements: FakeElement[] = []
  let nextId = 0
  let saves = 0
  let workbench: FakeElement[] = []
  const style = { strokeColor: '', backgroundColor: '', strokeWidth: 1, strokeStyle: 'solid', fontSize: 16, textAlign: 'left' }
  const push = (element: Omit<FakeElement, 'id'>, prefix: string): string => {
    const id = `${prefix}-${++nextId}`
    workbench.push({ id, ...element })
    return id
  }
  const api = {
    style,
    verifyMinimumPluginVersion: () => true,
    getAPI: () => api,
    reset: () => { workbench = [] },
    addFrame: (x: number, y: number, width: number, height: number, name?: string) => push({ type: 'frame', x, y, width, height, name: name ?? null }, 'frame'),
    addRect: (x: number, y: number, width: number, height: number) => push({ type: 'rectangle', x, y, width, height }, 'rect'),
    addEmbeddable: (x: number, y: number, width: number, height: number) => push({ type: 'embeddable', x, y, width, height }, 'card'),
    addText: (x: number, y: number, text: string, formatting: { width?: number; box?: string } = {}) => {
      const width = formatting.width ?? text.length * 8
      if (formatting.box !== 'box') return push({ type: 'text', x, y, width, height: 20, text, originalText: text, rawText: text }, 'text')
      const containerId = push({ type: 'rectangle', x, y, width, height: 120 }, 'box')
      push({ type: 'text', x, y, width, height: 20, text, originalText: text, rawText: text, containerId }, 'text')
      return containerId
    },
    getElement: (id: string) => workbench.find(element => element.id === id),
    getElements: () => workbench,
    getViewElements: () => elements.filter(element => !element.isDeleted),
    copyViewElementsToEAforEditing: (copies: FakeElement[]) => {
      workbench.push(...copies.filter(copy => !workbench.some(one => one.id === copy.id)).map(element => ({ ...element })))
    },
    addElementsToView: async () => {
      saves++
      for (const element of workbench) {
        const index = elements.findIndex(existing => existing.id === element.id)
        if (index < 0) elements.push(element)
        else elements[index] = element
      }
      workbench = []
      return true
    },
  }
  const app = {
    plugins: { plugins: { 'obsidian-excalidraw-plugin': { ea: api } } },
    workspace: { getMostRecentLeaf: () => undefined },
    vault: { getAbstractFileByPath: (path: string) => Object.assign(new TFile(), { path }) },
  } as unknown as App
  return { app, elements, view: { file: null } as DrawingView, saves: () => saves }
}

const SOURCE = 'run-source'
const FORK = 'run-fork'

const panel = (name: string, state: LayoutPanel['state'] = 'filled'): LayoutPanel => ({ name, node: name.toLowerCase(), text: '', lines: 3, state })
const panels = [panel('Idea'), panel('Character', 'pending'), panel('Gameplay', 'pending'), panel('World', 'pending')]

const firstHold: HoldRecord = {
  nodeId: 'hold-1', prompt: 'Pick a direction', input: '', reachedAt: 'now', revision: 1,
  candidates: [{ heading: 'Meta-Architect', body: 'A first idea.' }, { heading: 'Echoes', body: 'A second idea.' }],
}
const secondHold: HoldRecord = {
  nodeId: 'hold-2', prompt: 'Pick a world', input: '', reachedAt: 'later', revision: 1,
  candidates: [{ heading: 'idea a', body: 'One world.' }, { heading: 'idea b', body: 'Another world.' }, { heading: 'idea c', body: 'A third.' }],
}

const frame: RunFrame = {
  runId: SOURCE, name: 'creative-director · 10:00',
  box: { x: 0, y: 0, width: 1400, height: 400 },
  panels: panels.map((one, index) => ({ panel: { ...one, text: '' } as never, index, box: { x: 32 + index * 344, y: 32, width: 320, height: 240 }, emphasis: false })),
}

const row = (runId: string, heading: string, from = SOURCE, nodeId = 'hold-1', pending = [1, 2, 3]): RerunLanding => ({
  from: [from], runId, chainName: 'creative-director', panels, pick: { nodeId, heading, pending },
})
const outputs = (pending: number[]) => pending.map(index => ({ index, panel: panels[index]!, notePath: `runs/${index}.md` }))

async function pickedTwice(): Promise<ReturnType<typeof drawing> & { on: RunDrawing & RerunDrawing }> {
  const board = drawing()
  const on = createExcalidrawSurface(board.app).on(board.view) as unknown as RunDrawing & RerunDrawing
  await on.placeRun(frame, frame.panels.map(placed => ({ placed, notePath: `runs/${placed.index}.md` })))
  await on.placeHold(frame, firstHold, [1, 2, 3])
  await on.placePickRow(row(FORK, 'Meta-Architect'), outputs([1, 2, 3]))
  await on.placePickRow(row('run-echoes', 'Echoes'), outputs([1, 2, 3]))
  return { ...board, on }
}

type Box = { x: number; y: number; width: number; height: number }
const overlaps = (one: Box, other: Box): boolean =>
  one.x < other.x + other.width && other.x < one.x + one.width && one.y < other.y + other.height && other.y < one.y + one.height

/** Every pair of cards and candidate boxes that overlaps. */
function collisions(elements: readonly FakeElement[]): string[] {
  const blocks = elements.filter(element => !element.isDeleted && (element.type === 'embeddable'
    || (element.type === 'rectangle' && holdStamp(element)?.role === 'candidate')))
  const found: string[] = []
  for (const [at, one] of blocks.entries()) {
    for (const other of blocks.slice(at + 1)) if (overlaps(one, other)) found.push(`${one.id} & ${other.id}`)
  }
  return found
}

describe('a hold inside a pick row, on the drawing', () => {
  it('draws the column at the end of the row in one save, and moves the rows below out of its way', async () => {
    const board = await pickedTwice()
    const echoes = board.elements.find(element => holdStamp(element)?.heading === 'Echoes' && element.type === 'rectangle')!
    const echoesWas = echoes.y
    const savesBefore = board.saves()

    expect(await board.on.placeRowHold(row(FORK, 'Meta-Architect'), secondHold, [3])).toBe(true)

    expect(board.saves() - savesBefore).toBe(1)
    const live = board.elements.filter(element => !element.isDeleted)
    const nested = live.filter(element => holdStamp(element)?.runId === FORK && holdStamp(element)?.nodeId === 'hold-2')
    expect(nested.filter(element => holdStamp(element)?.role === 'candidate' && element.type === 'rectangle')).toHaveLength(3)
    expect(live.filter(element => element.type === 'embeddable' && JSON.stringify(element.customData).includes(FORK))).toHaveLength(2)
    expect(collisions(board.elements)).toEqual([])
    expect(live.find(element => element.id === echoes.id)!.y).toBeGreaterThan(echoesWas)

    const outline = nested.find(element => holdStamp(element)?.role === 'column' && element.type === 'rectangle')!
    const drawn = live.find(element => element.type === 'frame')!
    expect(outline.frameId).toBe(drawn.id)
    expect(outline.x + outline.width).toBeLessThanOrEqual(drawn.x + drawn.width)
    expect(outline.y + outline.height).toBeLessThanOrEqual(drawn.y + drawn.height)
  })

  it('draws a row\'s hold once, and grows a pick of it into a row to its right', async () => {
    const board = await pickedTwice()
    await board.on.placeRowHold(row(FORK, 'Meta-Architect'), secondHold, [3])
    const saves = board.saves()
    expect(await board.on.placeRowHold(row(FORK, 'Meta-Architect'), secondHold, [3])).toBe(false)
    expect(board.saves()).toBe(saves)

    expect(await board.on.placePickRow(row('run-deeper', 'idea b', FORK, 'hold-2', [3]), outputs([3]))).toBe(true)
    const candidate = board.elements.find(element => holdStamp(element)?.runId === FORK && holdStamp(element)?.heading === 'idea b' && element.type === 'rectangle')!
    const card = board.elements.find(element => element.type === 'embeddable' && JSON.stringify(element.customData).includes('run-deeper'))!
    expect(card.x).toBeGreaterThan(candidate.x + candidate.width)
    expect(card.y).toBe(candidate.y)
    expect(collisions(board.elements)).toEqual([])
  })
})
