import { describe, it, expect, beforeEach } from 'vitest'
import { CHAIN_GONE, ChainNodes, NODE_GONE, NO_DRAWING, NO_PARAMETER } from '@/ui/chainNodes'
import { chainNodeData, type ChainNodeElement } from '@/ui/chainNode'
import type { NodeSurface } from '@/ui/excalidraw'
import type { EngineClient } from '@/engine/client'
import type { ChainSummary } from '@/engine/types'
import type { App } from 'obsidian'
import { lastModal, openedModals, resetModals } from './obsidian'

/**
 * The seam between a chain node and the drawing it sits on: what the command
 * asks before placing anything, and what a click on either link does. The node's
 * own shape is checked in `chainNode.test.ts`.
 */

const personas: ChainSummary = {
  slug: 'five-personas',
  name: 'Five Personas',
  moment: 'when a premise feels safe',
  parameter: { name: 'audience', options: ['engineers', 'founders'] },
}

const relay: ChainSummary = { slug: 'relay', name: 'Relay', moment: 'when an idea needs handing on' }

let chains: ChainSummary[]
let online: boolean
let notices: string[]
let placed: ChainNodeElement[][]
let parameterSet: { nodeId: string; value: string; on?: unknown }[]
let onDrawing: string[]
let unavailable: string | undefined
let drawingOpen: boolean
let runs: { nodeId: string; groupIds?: readonly string[]; view?: unknown }[]

/** Lets the writes a picked row sets off finish before the assertions. */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

function makeNodes(): ChainNodes {
  const surface: NodeSurface = {
    selection: () => undefined,
    selectedProposal: () => undefined,
    placeProposals: async () => {},
    editProposal: async () => false,
    unavailable: () => unavailable,
    hasActiveDrawing: () => drawingOpen,
    // This only checks that a click reaches the run; `nodeRun.test.ts` has the rest.
    read: () => undefined,
    setRunStatus: () => Promise.resolve(true),
    placeRun: () => Promise.resolve(true),
    place: elements => {
      placed.push(elements)
      return Promise.resolve()
    },
    setParameter: (target, value, on) => {
      if (!onDrawing.includes(target.nodeId)) return Promise.resolve(false)
      parameterSet.push({ nodeId: target.nodeId, value, on })
      return Promise.resolve(true)
    },
  }

  return new ChainNodes({
    app: {} as unknown as App,
    engine: { listChains: () => Promise.resolve(chains) } as unknown as EngineClient,
    withEngine: async action => (online ? action() : undefined),
    notify: message => notices.push(message),
    surface,
    newNodeId: () => 'n-new',
    run: (data, element, view) => runs.push({ nodeId: data.nodeId, groupIds: element.groupIds, view }),
  })
}

/** The node a click arrives from, as the drawing hands it over. */
const element = (over: Record<string, unknown> = {}): { customData?: unknown } => ({
  customData: {
    chainRunner: {
      nodeId: 'n-1',
      role: 'parameter',
      chain: 'five-personas',
      chainName: 'Five Personas',
      parameterName: 'audience',
      parameterValue: 'engineers',
      ...over,
    },
  },
})

beforeEach(() => {
  chains = [personas, relay]
  online = true
  notices = []
  placed = []
  parameterSet = []
  onDrawing = ['n-1']
  unavailable = undefined
  drawingOpen = true
  runs = []
  resetModals()
})

describe('adding a chain node', () => {
  it('places the chain the reader picked, with the value they chose', async () => {
    await makeNodes().add()
    lastModal()?.choose(0)
    lastModal()?.choose(1)
    await flush()

    expect(placed).toHaveLength(1)
    const data = placed[0]?.map(one => chainNodeData(one))
    expect(data?.[0]).toMatchObject({ nodeId: 'n-new', chain: 'five-personas', parameterValue: 'founders' })
  })

  it('asks for the chain, then its dropdown, and nothing else', async () => {
    await makeNodes().add()
    lastModal()?.choose(0)
    expect(openedModals.map(modal => modal.placeholder)).toEqual([
      'Add which chain to this drawing?',
      'Choose audience',
    ])
  })

  it('places a chain that declares no dropdown straight from the picker', async () => {
    await makeNodes().add()
    lastModal()?.choose(1)
    await flush()

    expect(openedModals).toHaveLength(1)
    expect(placed[0]?.map(one => chainNodeData(one)?.role)).toEqual(['box', 'title', 'moment', 'run'])
  })

  it('says what is missing when Excalidraw is not there, and opens nothing', async () => {
    unavailable = 'Excalidraw is not installed'
    await makeNodes().add()
    expect(notices).toEqual(['Excalidraw is not installed'])
    expect(openedModals).toEqual([])
  })

  it('says to open a drawing when the tab in front is not one', async () => {
    drawingOpen = false
    await makeNodes().add()
    expect(notices).toEqual([NO_DRAWING])
    expect(openedModals).toEqual([])
  })

  it('places nothing while the engine is offline', async () => {
    online = false
    await makeNodes().add()
    expect(openedModals).toEqual([])
    expect(placed).toEqual([])
  })

  it('does not open an empty picker', async () => {
    chains = []
    await makeNodes().add()
    expect(notices).toEqual(['No chains in the workspace'])
    expect(openedModals).toEqual([])
  })
})

describe('clicking the node’s links', () => {
  it('never lets a click through to the browser or the vault', () => {
    const nodes = makeNodes()
    expect(nodes.handleLinkClick(element())).toBe(false)
    expect(nodes.handleLinkClick(element({ role: 'run' }))).toBe(false)
    expect(nodes.handleLinkClick(element({ role: 'box' }))).toBe(false)
  })

  it('leaves a link that is not a chain node to Excalidraw', () => {
    expect(makeNodes().handleLinkClick({ customData: undefined })).toBe(true)
    expect(notices).toEqual([])
  })

  it('hands a Run click to the run, with the node and view it came from', () => {
    const view = { drawing: true }
    expect(makeNodes().handleLinkClick({ ...element({ role: 'run' }), groupIds: ['g-1'] }, view)).toBe(false)
    expect(runs).toEqual([{ nodeId: 'n-1', groupIds: ['g-1'], view }])
    expect(notices).toEqual([])
  })

  it('rewrites the value the reader picks, on the node they clicked', async () => {
    makeNodes().handleLinkClick(element())
    await flush()
    expect(lastModal()?.placeholder).toBe('Choose audience')
    lastModal()?.choose(1)
    await flush()

    expect(parameterSet).toEqual([{ nodeId: 'n-1', value: 'founders' }])
  })

  it('rewrites on the drawing the click came from, not on the tab in front', async () => {
    // A drawing embedded in a note is not a tab; the click's own view is the handle.
    const embedded = { embedded: true }
    makeNodes().handleLinkClick(element(), embedded)
    await flush()
    lastModal()?.choose(0)
    await flush()

    expect(parameterSet[0]?.on).toBe(embedded)
  })

  it('says what is missing when Excalidraw is too old to rewrite with', async () => {
    unavailable = 'This Excalidraw is too old'
    makeNodes().handleLinkClick(element())
    await flush()
    expect(notices).toEqual(['This Excalidraw is too old'])
    expect(openedModals).toEqual([])
  })

  it('asks nothing while the engine is offline', async () => {
    online = false
    makeNodes().handleLinkClick(element())
    await flush()
    expect(openedModals).toEqual([])
    expect(parameterSet).toEqual([])
  })

  it('says so when the chain the node names has left the workspace', async () => {
    chains = [relay]
    makeNodes().handleLinkClick(element())
    await flush()
    expect(notices).toEqual([CHAIN_GONE('Five Personas')])
    expect(openedModals).toEqual([])
  })

  it('says so when the chain no longer declares a dropdown', async () => {
    chains = [{ ...personas, parameter: undefined }]
    makeNodes().handleLinkClick(element())
    await flush()
    expect(notices).toEqual([NO_PARAMETER('Five Personas')])
  })

  it('says so when the node has left the drawing before the pick landed', async () => {
    onDrawing = []
    makeNodes().handleLinkClick(element())
    await flush()
    lastModal()?.choose(0)
    await flush()
    expect(notices).toEqual([NODE_GONE])
  })
})
