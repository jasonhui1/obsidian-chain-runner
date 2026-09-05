import { describe, it, expect, beforeEach } from 'vitest'
import { CHAIN_GONE, ChainNodes, NODE_GONE, NO_CHAINS, NO_DRAWING, NO_PARAMETER, RUNNING_NOW } from '@/ui/chainNodes'
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
let placedOn: unknown[]
let parameterSet: { nodeId: string; value: string; on?: unknown }[]
let onDrawing: string[]
let unavailable: string | undefined
let drawingOpen: boolean
let runs: { nodeId: string; groupIds?: readonly string[]; view?: unknown }[]
let chainSet: { nodeId: string; chain: string; value?: string; on?: unknown }[]
/** The nodes with a run going, which is when a chain is not changed underneath one. */
let running: string[]
/** What the drawing says is selected when a double-click asks it. */
let selected: { customData?: unknown } | undefined
let selectedNodeOn: unknown[]
/** The drawings a finished drag asked to re-cut. */
let reflowedOn: unknown[]
/** The clock the double-click's freshness window is measured on. */
let clock: number
/**
 * How the press behind a selection settles: a point when it was a click, and
 * `undefined` for a drag, a keyboard selection or no press at all.
 */
let clickSpot: { x: number; y: number } | undefined

/** Lets the writes a picked row sets off finish before the assertions. */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

function makeSurface(): NodeSurface {
  return {
    selection: () => undefined,
    selectedNode: on => {
      selectedNodeOn.push(on)
      if (!drawingOpen) throw new Error('Open the Excalidraw drawing as its own tab to do that.')
      return selected
    },
    reflow: on => {
      if (!drawingOpen) return Promise.reject(new Error('Open the Excalidraw drawing as its own tab to do that.'))
      reflowedOn.push(on)
      return Promise.resolve(true)
    },
    selectedProposal: () => undefined,
    placeProposals: async () => {},
    editProposal: async () => false,
    unavailable: () => unavailable,
    hasActiveDrawing: () => drawingOpen,
    // This only checks that a click reaches the run; `nodeRun.test.ts` has the rest.
    read: () => undefined,
    setRunStatus: () => Promise.resolve(true),
    placeRun: () => Promise.resolve(true),
    place: (elements, on) => {
      placed.push(elements)
      placedOn.push(on)
      return Promise.resolve()
    },
    setChain: (target, chain, value, on) => {
      if (!onDrawing.includes(target.nodeId)) return Promise.resolve(false)
      chainSet.push({ nodeId: target.nodeId, chain: chain.slug, value, on })
      return Promise.resolve(true)
    },
    setParameter: (target, value, on) => {
      if (!onDrawing.includes(target.nodeId)) return Promise.resolve(false)
      parameterSet.push({ nodeId: target.nodeId, value, on })
      return Promise.resolve(true)
    },
  }
}

function makeNodes(): ChainNodes {
  return new ChainNodes({
    app: {} as unknown as App,
    engine: { listChains: () => Promise.resolve(chains) } as unknown as EngineClient,
    withEngine: async action => (online ? action() : undefined),
    notify: message => notices.push(message),
    surface: makeSurface(),
    newNodeId: () => 'n-new',
    run: (data, element, view) => runs.push({ nodeId: data.nodeId, groupIds: element.groupIds, view }),
    isRunning: nodeId => running.includes(nodeId),
    clickSpot: settled => settled(clickSpot),
    pressSpot: () => clickSpot,
    now: () => clock,
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
  placedOn = []
  chainSet = []
  running = []
  parameterSet = []
  onDrawing = ['n-1']
  unavailable = undefined
  drawingOpen = true
  runs = []
  clickSpot = { x: 0, y: 0 }
  selected = undefined
  selectedNodeOn = []
  reflowedOn = []
  clock = 1000
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
    expect(placed[0]?.map(one => chainNodeData(one)?.role)).toEqual(['box', 'chain', 'moment', 'run'])
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

describe('dropping a node with no chain yet', () => {
  it('places one with nothing picked, so the chain is chosen on the node', async () => {
    await makeNodes().placeUnset()
    expect(placed).toHaveLength(1)
    expect(chainNodeData(placed[0]?.[0] as ChainNodeElement)).toMatchObject({ nodeId: 'n-new', chain: '' })
  })

  it('opens no picker at all — that is the point of the button', async () => {
    await makeNodes().placeUnset()
    expect(openedModals).toHaveLength(0)
  })

  it('places it on the drawing the button was pressed on', async () => {
    const view = { drawing: true }
    await makeNodes().placeUnset(view)
    expect(placedOn).toEqual([view])
  })

  it('says so when there is no drawing to put one on', async () => {
    drawingOpen = false
    await makeNodes().placeUnset()
    expect(notices).toEqual([NO_DRAWING])
    expect(placed).toEqual([])
  })

  it('says why when Excalidraw cannot be used', async () => {
    unavailable = 'Excalidraw is too old'
    await makeNodes().placeUnset()
    expect(notices).toEqual(['Excalidraw is too old'])
  })
})

describe('clicking the chain line', () => {
  const chainLine = (over: Record<string, unknown> = {}): { customData?: unknown } =>
    element({ role: 'chain', ...over })

  it('swallows the click, so the drawing never opens the link', () => {
    expect(makeNodes().handleLinkClick(chainLine())).toBe(false)
  })

  it('offers the workspace chains, then writes the one picked', async () => {
    makeNodes().handleLinkClick(chainLine())
    await flush()
    expect(lastModal()?.placeholder).toBe('Which chain should this node run?')
    lastModal()?.choose(1)
    await flush()
    expect(chainSet).toEqual([{ nodeId: 'n-1', chain: 'relay', value: undefined, on: undefined }])
  })

  it('asks for the new chain dropdown when it declares one', async () => {
    makeNodes().handleLinkClick(chainLine())
    await flush()
    lastModal()?.choose(0)
    expect(lastModal()?.placeholder).toBe('Choose audience')
    lastModal()?.choose(1)
    await flush()
    expect(chainSet[0]).toMatchObject({ chain: 'five-personas', value: 'founders' })
  })

  it('writes to the drawing the click came from', async () => {
    const view = { drawing: true }
    makeNodes().handleLinkClick(chainLine(), view)
    await flush()
    lastModal()?.choose(1)
    await flush()
    expect(chainSet[0]?.on).toBe(view)
  })

  it('rewrites only the copy of the node that was clicked', async () => {
    makeNodes().handleLinkClick({ ...chainLine(), groupIds: ['g-1'] })
    await flush()
    lastModal()?.choose(1)
    await flush()
    expect(chainSet).toHaveLength(1)
  })

  it('says the node is gone when it was deleted between the click and the pick', async () => {
    onDrawing = []
    makeNodes().handleLinkClick(chainLine())
    await flush()
    lastModal()?.choose(1)
    await flush()
    expect(notices).toEqual([NODE_GONE])
  })

  it('says why when Excalidraw cannot be used, and opens nothing', async () => {
    unavailable = 'Excalidraw is too old'
    makeNodes().handleLinkClick(chainLine())
    await flush()
    expect(notices).toEqual(['Excalidraw is too old'])
    expect(openedModals).toHaveLength(0)
  })

  it('opens nothing when the engine cannot be reached', async () => {
    online = false
    makeNodes().handleLinkClick(chainLine())
    await flush()
    expect(openedModals).toHaveLength(0)
  })

  it('says there is nothing to choose from when the workspace has no chains', async () => {
    chains = []
    makeNodes().handleLinkClick(chainLine())
    await flush()
    expect(notices).toEqual([NO_CHAINS])
  })

  it('refuses to change the chain of a node that is running', async () => {
    running = ['n-1']
    makeNodes().handleLinkClick(chainLine())
    await flush()
    expect(notices).toEqual([RUNNING_NOW])
    expect(openedModals).toHaveLength(0)
  })

  it('answers a click on a node drawn before the chain line was clickable', async () => {
    makeNodes().handleLinkClick(chainLine({ role: 'title' }))
    await flush()
    expect(lastModal()?.placeholder).toBe('Which chain should this node run?')
  })
})

describe('clicking a node without a modifier', () => {
  const line = (role: string): { customData?: unknown } => element({ role })

  it('opens the chain picker on the chain line', async () => {
    makeNodes().handleSelection(line('chain'))
    await flush()
    expect(lastModal()?.placeholder).toBe('Which chain should this node run?')
  })

  it('opens the dropdown on the parameter line', async () => {
    makeNodes().handleSelection(line('parameter'))
    await flush()
    expect(lastModal()?.placeholder).toBe('Choose audience')
  })

  it('writes the pick through, on the drawing the click came from', async () => {
    const view = { drawing: true }
    makeNodes().handleSelection(line('chain'), view)
    await flush()
    lastModal()?.choose(1)
    await flush()
    expect(chainSet).toEqual([{ nodeId: 'n-1', chain: 'relay', value: undefined, on: view }])
  })

  it('does not start a run: selecting is not asking for one, and a run is not undone', async () => {
    makeNodes().handleSelection(line('run'))
    await flush()
    expect(runs).toEqual([])
    expect(openedModals).toEqual([])
  })

  it('does nothing on the parts of the node that are not a decision', async () => {
    const nodes = makeNodes()
    nodes.handleSelection(line('box'))
    nodes.handleSelection(line('moment'))
    await flush()
    expect(openedModals).toEqual([])
  })

  it('ignores anything on the drawing that is not a chain node', async () => {
    makeNodes().handleSelection({ customData: undefined })
    await flush()
    expect(openedModals).toEqual([])
    expect(notices).toEqual([])
  })

  it('still refuses to change the chain of a node that is running', async () => {
    running = ['n-1']
    makeNodes().handleSelection(line('chain'))
    await flush()
    expect(notices).toEqual([RUNNING_NOW])
  })
})

describe('where the picker opens', () => {
  it('opens beside the press that selected the node', async () => {
    clickSpot = { x: 220, y: 340 }
    makeNodes().handleSelection(element({ role: 'chain' }))
    await flush()
    expect(lastModal()?.anchor).toEqual({ x: 220, y: 340 })
  })

  it('anchors the dropdown too, so both decisions land in the same place', async () => {
    clickSpot = { x: 12, y: 24 }
    makeNodes().handleSelection(element({ role: 'parameter' }))
    await flush()
    expect(lastModal()?.anchor).toEqual({ x: 12, y: 24 })
  })

  it('anchors the dropdown that follows a chain pick to the same press', async () => {
    clickSpot = { x: 50, y: 60 }
    makeNodes().handleSelection(element({ role: 'chain' }))
    await flush()
    lastModal()?.choose(0)
    expect(lastModal()?.placeholder).toBe('Choose audience')
    expect(lastModal()?.anchor).toEqual({ x: 50, y: 60 })
  })

  it('leaves the palette’s own picker centre-screen: that click was on the palette', async () => {
    clickSpot = { x: 5, y: 5 }
    await makeNodes().add()
    expect(lastModal()?.anchor).toBeUndefined()
  })
})

describe('what a selection has to be before anything opens', () => {
  const chainLine = (): { customData?: unknown } => element({ role: 'chain' })

  it('opens nothing for a selection no press caused, which is the keyboard', async () => {
    clickSpot = undefined
    makeNodes().handleSelection(chainLine())
    await flush()
    expect(openedModals).toEqual([])
    expect(notices).toEqual([])
  })

  it('opens nothing when the press turned out to be a drag', async () => {
    // The drawing reports the selection on pointer-down; a drag settles as nothing.
    clickSpot = undefined
    makeNodes().handleSelection(chainLine())
    await flush()
    expect(openedModals).toEqual([])
  })

  it('waits for the press to settle before opening anything', async () => {
    let settle: ((at: { x: number; y: number } | undefined) => void) | undefined
    const nodes = new ChainNodes({
      app: {} as unknown as App,
      engine: { listChains: () => Promise.resolve(chains) } as unknown as EngineClient,
      withEngine: async action => action(),
      notify: message => notices.push(message),
      surface: makeSurface(),
      newNodeId: () => 'n-new',
      run: () => {},
      isRunning: () => false,
      clickSpot: settled => {
        settle = settled
      },
      pressSpot: () => undefined,
      now: () => clock,
    })

    nodes.handleSelection(chainLine())
    await flush()
    expect(openedModals).toEqual([])

    settle?.({ x: 7, y: 9 })
    await flush()
    expect(lastModal()?.placeholder).toBe('Which chain should this node run?')
    expect(lastModal()?.anchor).toEqual({ x: 7, y: 9 })
  })

  it('still follows a link, since Ctrl/Cmd+click is already a click', async () => {
    clickSpot = undefined
    makeNodes().handleLinkClick(chainLine())
    await flush()
    expect(lastModal()?.placeholder).toBe('Which chain should this node run?')
  })
})

describe('double-clicking a node', () => {
  const line = (role: string): { customData?: unknown } => element({ role })

  it('runs when Excalidraw opens its text editor on ▶ Run, which is its own double-click', () => {
    makeNodes().handleTextEdit(line('run'))
    expect(runs).toEqual([{ nodeId: 'n-1', groupIds: undefined, view: undefined }])
  })

  it('runs on the drawing the editor opened in', () => {
    const view = { embedded: true }
    makeNodes().handleTextEdit(line('run'), view)
    expect(runs[0]?.view).toBe(view)
  })

  it('does not run when the reader opened another line to type in it', () => {
    const nodes = makeNodes()
    nodes.handleTextEdit(line('chain'))
    nodes.handleTextEdit(line('moment'))
    expect(runs).toEqual([])
  })

  it('ignores a text element that is not part of a node', () => {
    makeNodes().handleTextEdit({ customData: undefined })
    expect(runs).toEqual([])
  })

  it('does not restart a run already going, however the double-click is reported', () => {
    running = ['n-1']
    selected = line('run')
    const nodes = makeNodes()
    nodes.handleTextEdit(line('run'))
    nodes.handleDoubleClick()
    expect(runs).toEqual([])
  })

  it('starts one run when both routes report the same double-click', () => {
    // The editor opening and the browser's own dblclick are one gesture.
    selected = line('run')
    const nodes = makeNodes()
    nodes.handleTextEdit(line('run'))
    running = ['n-1']
    nodes.handleDoubleClick()
    expect(runs).toHaveLength(1)
  })

  it('runs the node the first click of the double already selected', () => {
    // From an empty canvas: click one selects ▶ Run, click two is the double.
    const nodes = makeNodes()
    nodes.handleSelection(line('run'))
    nodes.handleDoubleClick()
    expect(runs).toEqual([{ nodeId: 'n-1', groupIds: undefined, view: undefined }])
  })

  it('runs on the line a double drilled into, which the drawing reports after it', () => {
    // A node is a group: the first click selects all of it and names no line,
    // and only the double picks out ▶ Run — reported once the double is over.
    const view = { embedded: true }
    const nodes = makeNodes()
    nodes.handleDoubleClick()
    expect(runs).toEqual([])
    nodes.handleSelection(line('run'), view)
    expect(runs).toEqual([{ nodeId: 'n-1', groupIds: undefined, view }])
  })

  it('does not run on a selection that arrives long after the double', () => {
    const nodes = makeNodes()
    nodes.handleDoubleClick()
    clock = 9000
    nodes.handleSelection(line('run'))
    expect(runs).toEqual([])
  })

  it('opens the picker, and runs nothing, when the double drilled into another line', async () => {
    // A node is a group, so the double-click *is* how the chain line is reached.
    const nodes = makeNodes()
    nodes.handleDoubleClick()
    nodes.handleSelection(line('chain'))
    await flush()
    expect(runs).toEqual([])
    expect(lastModal()?.placeholder).toBe('Which chain should this node run?')
  })

  it('opens the dropdown when the double drilled into the parameter line', async () => {
    const nodes = makeNodes()
    nodes.handleDoubleClick()
    nodes.handleSelection(line('parameter'))
    await flush()
    expect(lastModal()?.placeholder).toBe('Choose audience')
  })

  it('does not open a picker on the line it ran', async () => {
    const nodes = makeNodes()
    nodes.handleDoubleClick()
    nodes.handleSelection(line('run'))
    await flush()
    expect(runs).toHaveLength(1)
    expect(openedModals).toEqual([])
  })

  it('spends the double once, so the next click on ▶ Run does not run it', () => {
    const nodes = makeNodes()
    nodes.handleDoubleClick()
    nodes.handleSelection(line('run'))
    nodes.handleSelection(line('run'))
    expect(runs).toHaveLength(1)
  })

  it('does not run on an ordinary click, with no double before it', () => {
    makeNodes().handleSelection(line('run'))
    expect(runs).toEqual([])
  })

  it('runs the node still selected, when the first click changed nothing', () => {
    selected = line('run')
    makeNodes().handleDoubleClick()
    expect(runs).toEqual([{ nodeId: 'n-1', groupIds: undefined, view: undefined }])
  })

  it('does not take a click too old to be half of this double', () => {
    const nodes = makeNodes()
    nodes.handleSelection(line('run'))
    clock = 9000
    nodes.handleDoubleClick()
    expect(runs).toEqual([])
  })

  it('spends the first click once, so one double-click is one run', () => {
    const nodes = makeNodes()
    nodes.handleSelection(line('run'))
    nodes.handleDoubleClick()
    nodes.handleDoubleClick()
    expect(runs).toHaveLength(1)
  })

  it('runs on the drawing the click that selected it came from', () => {
    const view = { embedded: true }
    const nodes = makeNodes()
    nodes.handleSelection(line('run'), view)
    nodes.handleDoubleClick()
    expect(runs[0]?.view).toBe(view)
  })

  it('asks the drawing on the view the node was last selected on', () => {
    const view = { embedded: true }
    const nodes = makeNodes()
    nodes.handleSelection(line('chain'), view)
    clock = 9000
    nodes.handleDoubleClick()
    expect(selectedNodeOn).toEqual([view])
  })

  it('runs nothing when the selection is another part of the node', () => {
    selected = line('chain')
    makeNodes().handleDoubleClick()
    expect(runs).toEqual([])
  })

  it('runs nothing when nothing on the drawing is selected', () => {
    selected = undefined
    makeNodes().handleDoubleClick()
    expect(runs).toEqual([])
  })

  it('says nothing when the double-click was not on a drawing at all', () => {
    // Every double-click in the workspace reaches this; only a drawing answers.
    drawingOpen = false
    makeNodes().handleDoubleClick()
    expect(notices).toEqual([])
    expect(runs).toEqual([])
  })

  it('says why when Excalidraw cannot be used, rather than running', () => {
    unavailable = 'This Excalidraw is too old'
    selected = line('run')
    makeNodes().handleDoubleClick()
    expect(runs).toEqual([])
    expect(notices).toEqual(['This Excalidraw is too old'])
  })
})

describe('finishing a drag that resized a node', () => {
  it('asks the drawing to cut the node’s lines to its new width', () => {
    makeNodes().handleResize()
    expect(reflowedOn).toEqual([undefined])
  })

  it('asks the drawing the node was last selected on, not the tab in front', () => {
    const view = { embedded: true }
    const nodes = makeNodes()
    nodes.handleSelection(element({ role: 'chain' }), view)
    nodes.handleResize()
    expect(reflowedOn).toEqual([view])
  })

  it('says nothing when the drag was not on a drawing at all', async () => {
    // Every pointer release in the workspace reaches this.
    drawingOpen = false
    makeNodes().handleResize()
    await flush()
    expect(notices).toEqual([])
  })
})
