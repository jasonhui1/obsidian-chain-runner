import { describe, expect, it } from 'vitest'
import { createExcalidrawSurface, type DrawingView, type PickDrawing, type RerunSurface } from '@/ui/excalidraw'
import { holdStamp, stampHold } from '@/ui/holdColumn'
import type { App } from 'obsidian'
import type { HoldRecord } from '@/engine/types'

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
  strokeStyle?: string
  isDeleted?: boolean
}

function drawing(elements: FakeElement[] = []): { app: App; elements: FakeElement[]; view: DrawingView } {
  let nextId = 0
  let workbench: FakeElement[] = []
  const style = { strokeColor: '', backgroundColor: '', strokeWidth: 1, strokeStyle: 'solid', fontSize: 16, textAlign: 'left' }
  const api = {
    style,
    verifyMinimumPluginVersion: () => true,
    getAPI: () => api,
    reset: () => {
      workbench = []
    },
    addRect: (x: number, y: number, width: number, height: number) => {
      const id = `rect-${++nextId}`
      workbench.push({ id, type: 'rectangle', x, y, width, height, strokeStyle: style.strokeStyle })
      return id
    },
    addText: (x: number, y: number, text: string, formatting: { width?: number; box?: string } = {}) => {
      if (formatting.box === 'box') {
        const containerId = `rect-${++nextId}`
        const textId = `text-${++nextId}`
        workbench.push({
          id: containerId,
          type: 'rectangle',
          x,
          y,
          width: formatting.width ?? 320,
          height: 120,
          strokeStyle: style.strokeStyle,
        })
        workbench.push({
          id: textId,
          type: 'text',
          x,
          y,
          width: formatting.width ?? 320,
          height: 20,
          text,
          originalText: text,
          rawText: text,
          containerId,
        })
        return containerId
      }
      const id = `text-${++nextId}`
      workbench.push({
        id,
        type: 'text',
        x,
        y,
        width: formatting.width ?? text.length * 8,
        height: style.fontSize * 1.25,
        text,
        originalText: text,
        rawText: text,
      })
      return id
    },
    getElement: (id: string) => workbench.find(element => element.id === id) ?? elements.find(element => element.id === id),
    getElements: () => [...workbench],
    getViewElements: () => elements.filter(element => !element.isDeleted),
    copyViewElementsToEAforEditing: (copies: FakeElement[]) => {
      for (const copy of copies) {
        if (!workbench.some(existing => existing.id === copy.id)) {
          workbench.push({ ...copy })
        }
      }
    },
    addElementsToView: async () => {
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
  } as unknown as App
  const view = { file: null } as DrawingView
  return { app, elements, view }
}

const hold: HoldRecord = {
  nodeId: 'hold-1',
  prompt: 'Choose direction',
  input: '',
  reachedAt: 'now',
  revision: 1,
  candidates: [
    { heading: 'Candidate 1', body: 'First idea' },
  ],
}

describe('custom candidate on the Excalidraw drawing', () => {
  it('draws ✎ Your own, reads typed text, places pick row, and adds fresh empty card', async () => {
    const runId = 'run-123'
    const nodeId = 'hold-1'
    const initialElements: FakeElement[] = [
      {
        id: 'column-rect',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 360,
        height: 400,
        customData: stampHold({ runId, nodeId, heading: '', role: 'column' }),
      },
    ]
    const { app, elements, view } = drawing(initialElements)
    const surface = createExcalidrawSurface(app)

    await (surface as unknown as RerunSurface).on(view).refreshHoldColumn(runId, nodeId, hold)

    const customCards = elements.filter(element => {
      const stamp = holdStamp(element)
      return stamp?.role === 'custom' && stamp.runId === runId && stamp.nodeId === nodeId
    })
    expect(customCards.length).toBeGreaterThanOrEqual(2)

    const customBound = elements.find(element => element.type === 'text' && element.text === '✎ Your own')!
    expect(customBound).toBeDefined()
    expect(holdStamp(customBound)?.role).toBe('custom')

    const continueLines = elements.filter(element => {
      const stamp = holdStamp(element)
      return stamp?.role === 'continue' && stamp.custom && stamp.runId === runId && stamp.nodeId === nodeId
    })
    expect(continueLines).toHaveLength(1)
    expect(continueLines[0]!.text).toBe('▶ Continue')

    customBound.text = 'Player-driven economy\nTrading with dynamic tariffs'
    customBound.rawText = customBound.text
    customBound.originalText = customBound.text

    const pickDrawing = surface.on(view) as unknown as PickDrawing
    expect(pickDrawing.customCandidate!(runId, nodeId)).toBe('Player-driven economy\nTrading with dynamic tariffs')

    const heading = 'Player-driven economy'
    const landing = {
      from: [runId],
      runId: 'run-456',
      chainName: 'econ',
      panels: [],
      pick: { nodeId, heading, pending: [] },
    }
    const placed = await (surface as unknown as RerunSurface).on(view).placePickRow(landing, [])
    expect(placed).toBe(true)

    const customContainer = elements.find(element => element.id === customBound.containerId)!
    const updatedBound = elements.find(element => element.id === customBound.id)!
    expect(customContainer.strokeStyle).toBe('solid')
    expect(holdStamp(customContainer)?.heading).toBe(heading)
    expect(holdStamp(updatedBound)?.heading).toBe(heading)

    const oldContinue = elements.find(element => element.id === continueLines[0]!.id)!
    expect(oldContinue.isDeleted).toBe(true)

    const freshCards = elements.filter(element => {
      const stamp = holdStamp(element)
      return !element.isDeleted && stamp?.role === 'custom' && !stamp.heading
    })
    expect(freshCards.length).toBeGreaterThanOrEqual(2)
    const freshText = freshCards.find(element => element.type === 'text')!
    expect(freshText.text).toBe('✎ Your own')

    expect(pickDrawing.customCandidate!(runId, nodeId)).toBe('✎ Your own')

    const activeContinues = elements.filter(element => {
      const stamp = holdStamp(element)
      return !element.isDeleted && stamp?.role === 'continue' && stamp.custom && stamp.runId === runId
    })
    expect(activeContinues).toHaveLength(1)
    expect(activeContinues[0]!.id).not.toBe(oldContinue.id)

    freshText.text = 'Faction reputation system\nBounties and territory wars'
    freshText.rawText = freshText.text
    freshText.originalText = freshText.text

    expect(pickDrawing.customCandidate!(runId, nodeId)).toBe('Faction reputation system\nBounties and territory wars')

    const secondHeading = 'Faction reputation system'
    const secondLanding = {
      from: [runId],
      runId: 'run-789',
      chainName: 'econ',
      panels: [],
      pick: { nodeId, heading: secondHeading, pending: [] },
    }
    const secondPlaced = await (surface as unknown as RerunSurface).on(view).placePickRow(secondLanding, [])
    expect(secondPlaced).toBe(true)

    const secondContainer = elements.find(element => element.id === freshText.containerId)!
    const updatedSecondBound = elements.find(element => element.id === freshText.id)!
    expect(secondContainer.strokeStyle).toBe('solid')
    expect(holdStamp(secondContainer)?.heading).toBe(secondHeading)
    expect(holdStamp(updatedSecondBound)?.heading).toBe(secondHeading)

    expect(pickDrawing.customCandidate!(runId, nodeId)).toBe('✎ Your own')
  })

  it('updates placeholder text to candidate heading on rebuild and picks unpicked card on duplicate heading', async () => {
    const runId = 'run-dup'
    const nodeId = hold.nodeId
    const initialElements: FakeElement[] = [
      {
        id: 'column-rect',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 360,
        height: 400,
        customData: stampHold({ runId, nodeId, heading: '', role: 'column' }),
      },
    ]
    const { app, elements, view } = drawing(initialElements)
    const surface = createExcalidrawSurface(app)

    await (surface as unknown as RerunSurface).on(view).refreshHoldColumn(runId, nodeId, hold)

    const heading = 'Same heading'
    const landing1 = {
      from: [runId],
      runId: 'run-dup-1',
      chainName: 'test',
      panels: [],
      pick: { nodeId, heading, pending: [] },
    }
    await (surface as unknown as RerunSurface).on(view).placePickRow(landing1, [])

    const firstCardText = elements.find(element => element.type === 'text' && holdStamp(element)?.heading === heading)!
    expect(firstCardText.text).toBe(heading)

    const landing2 = {
      from: [runId],
      runId: 'run-dup-2',
      chainName: 'test',
      panels: [],
      pick: { nodeId, heading, pending: [] },
    }
    await (surface as unknown as RerunSurface).on(view).placePickRow(landing2, [])

    const pickedCards = elements.filter(element => {
      const stamp = holdStamp(element)
      return element.type === 'rectangle' && stamp?.role === 'custom' && stamp.heading === heading
    })
    expect(pickedCards).toHaveLength(2)
  })
})
