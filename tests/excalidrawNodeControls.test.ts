import { describe, expect, it } from 'vitest'
import { buildChainNode, chainNodeData, RUN_COUNT_LINK } from '@/ui/chainNode'
import { createExcalidrawSurface, type DrawingView, type NodeSurface, type RunSurface } from '@/ui/excalidraw'
import type { App } from 'obsidian'

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
  groupIds?: string[]
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
      const id = `new-${++nextId}`
      workbench.push({ id, type: 'rectangle', x, y, width, height })
      return id
    },
    addText: (x: number, y: number, text: string, formatting: { width?: number } = {}) => {
      const id = `new-${++nextId}`
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
    getElement: (id: string) => workbench.find(element => element.id === id),
    getViewElements: () => elements,
    addToGroup: (ids: string[]) => {
      const groupId = `group-${nextId}`
      for (const element of workbench) if (ids.includes(element.id)) element.groupIds = [groupId]
      return groupId
    },
    copyViewElementsToEAforEditing: (copies: FakeElement[]) => {
      workbench.push(...copies.map(element => ({ ...element, groupIds: [...(element.groupIds ?? [])] })))
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

const chain = { slug: 'creative-director', name: 'creative-director', moment: 'you have a mood, or nothing' }

describe('the Excalidraw node run-count control', () => {
  it('places the count field with the node, reads it from the scene, and upgrades older nodes', async () => {
    const fresh = drawing()
    const surface = createExcalidrawSurface(fresh.app)
    await surface.on(fresh.view).place(buildChainNode(chain, { nodeId: 'new-node' }))

    const freshCounts = fresh.elements.filter(element => {
      const role = chainNodeData(element)?.role
      return role === 'run-count' || role === 'run-count-box'
    })
    expect(freshCounts.map(element => chainNodeData(element)?.role)).toEqual(['run-count-box', 'run-count'])
    expect(freshCounts.every(element => element.groupIds?.length === 1)).toBe(true)
    expect(freshCounts.every(element => element.link === RUN_COUNT_LINK)).toBe(true)
    expect((surface as RunSurface).on(fresh.view).read({ nodeId: 'new-node' })?.runCount).toBe('1')
    await (surface as NodeSurface).on(fresh.view).setRunCount({ nodeId: 'new-node' }, 5)
    expect((surface as RunSurface).on(fresh.view).read({ nodeId: 'new-node' })?.runCount).toBe('5')

    const legacyElements = buildChainNode(chain, { nodeId: 'old-node' })
      .filter(element => element.role !== 'run-count' && element.role !== 'run-count-box')
      .map((element, index): FakeElement => ({
        id: `old-${index}`,
        type: element.shape === 'rect' ? 'rectangle' : 'text',
        x: 100 + element.x,
        y: 200 + element.y,
        width: element.width,
        height: element.height,
        text: element.text,
        originalText: element.text,
        rawText: element.text,
        customData: element.customData,
        groupIds: ['old-group'],
      }))
    const legacy = drawing(legacyElements)
    const legacySurface = createExcalidrawSurface(legacy.app)
    await legacySurface.on(legacy.view).upgradeRunCounts()

    const oldCounts = legacy.elements.filter(element => {
      const role = chainNodeData(element)?.role
      return role === 'run-count' || role === 'run-count-box'
    })
    expect(oldCounts.map(element => chainNodeData(element)?.role)).toEqual(['run-count-box', 'run-count'])
    expect(oldCounts.every(element => element.groupIds?.includes('old-group'))).toBe(true)
    expect((legacySurface as RunSurface).on(legacy.view).read({ nodeId: 'old-node' })?.runCount).toBe('1')
    const field = oldCounts.find(element => chainNodeData(element)?.role === 'run-count')!
    field.text = '3'
    field.originalText = '3'
    expect((legacySurface as RunSurface).on(legacy.view).read({ nodeId: 'old-node' })?.runCount).toBe('3')
  })
})
