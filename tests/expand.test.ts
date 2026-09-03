import { describe, it, expect, beforeEach } from 'vitest'
import {
  ALREADY_EXPANDING,
  EXPANDING,
  Expand,
  NOTHING_TO_EXPAND,
  NO_CHAINS,
  NO_PROPOSALS,
  PROPOSAL_GONE,
  SELECT_A_PROPOSAL,
} from '@/ui/expand'
import { SELECT_ONE_BLOCK, type BlockReading, type NodeSurface, type PlacedProposal } from '@/ui/excalidraw'
import { UNSUPPORTED_STREAMING } from '@/run/stream'
import { OFFLINE_NOTICE } from '@/engine/guard'
import { OutputNotes } from '@/ui/outputNotes'
import type { ProposalData } from '@/ui/proposal'
import type { EngineClient } from '@/engine/client'
import type { Capabilities, ChainSummary, RunEvent } from '@/engine/types'
import type { App } from 'obsidian'
import { lastModal, resetModals, TFile as StubFile, TFolder } from './obsidian'

/** The order an expansion happens in. The pure pieces are checked in their own files. */

const personas: ChainSummary = { slug: 'personas', name: 'Five Personas', view: 'columns', seeded: true }

const ENGINE_URL = 'http://localhost:3000'
const RUN_ID = '2026-09-03-cd34e'
const OPTIMIST = `chains/runs/${RUN_ID}/Optimist.md`
const SKEPTIC = `chains/runs/${RUN_ID}/Skeptic.md`

let block: BlockReading | undefined
let events: RunEvent[]
let capabilities: Capabilities
let chains: ChainSummary[]
let online: boolean

let launched: { chainName: string; seedPrompt: string; paramValue?: string }[]
let notices: string[]
let placed: { proposals: readonly PlacedProposal[]; sourceId: string }[]
let edits: { proposalId: string; action: 'accept' | 'dismiss' }[]
let selectedProposal: ProposalData | undefined
let editable: boolean
let vault: Record<string, string>
let folders: string[]
let trashed: string[]
let proposalIds: number

const file = (path: string): StubFile => {
  const stub = new StubFile()
  stub.path = path
  return stub
}

/** The engine's own layout frame: `n` panels, the first `done` of them settled. */
const layout = (names: string[], done: number): RunEvent => ({
  type: 'layout',
  model: {
    kind: 'columns',
    panels: names.map((name, index) => ({
      name,
      node: name.toLowerCase(),
      text: index < done ? `${name} said something` : '',
      lines: index < done ? 1 : 0,
      state: index < done ? ('filled' as const) : ('pending' as const),
    })),
  },
})

/** A run that names itself, declares two outputs, fills both and completes. */
const finishes = (): RunEvent[] => [
  { type: 'run_start', runId: RUN_ID },
  layout(['Optimist', 'Skeptic'], 0),
  layout(['Optimist', 'Skeptic'], 1),
  layout(['Optimist', 'Skeptic'], 2),
  { type: 'run_complete', runId: RUN_ID },
]

function makeExpand(): Expand {
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => {
        if (vault[path] !== undefined) return file(path)
        if (!folders.includes(path)) return null
        const folder = new TFolder()
        folder.path = path
        return folder
      },
      cachedRead: (target: { path: string }) => Promise.resolve(vault[target.path] ?? ''),
      create: (path: string, content: string) => {
        vault[path] = content
        return Promise.resolve(file(path))
      },
      modify: (target: { path: string }, content: string) => {
        vault[target.path] = content
        return Promise.resolve()
      },
      createFolder: (path: string) => {
        folders.push(path)
        return Promise.resolve(undefined)
      },
    },
    fileManager: {
      trashFile: (target: { path: string }) => {
        trashed.push(target.path)
        delete vault[target.path]
        return Promise.resolve()
      },
    },
    metadataCache: {
      getFirstLinkpathDest: (linkpath: string) => {
        const path = linkpath.endsWith('.md') ? linkpath : `${linkpath}.md`
        return vault[path] === undefined ? null : file(path)
      },
    },
  } as unknown as App

  const surface: NodeSurface = {
    unavailable: () => undefined,
    hasActiveDrawing: () => true,
    place: () => Promise.resolve(),
    setParameter: () => Promise.resolve(true),
    read: () => undefined,
    setRunStatus: () => Promise.resolve(true),
    placeRun: () => Promise.resolve(true),
    selection: () => block,
    selectedProposal: () => selectedProposal,
    placeProposals: (proposals, source) => {
      placed.push({ proposals, sourceId: source.id })
      return Promise.resolve()
    },
    editProposal: (proposalId, action) => {
      edits.push({ proposalId, action })
      return Promise.resolve(editable)
    },
  }

  const engine = {
    loadWorkspace: () => Promise.resolve({ chains, capabilities }),
    launchRun: async function* (request: { chainName: string; seedPrompt: string; paramValue?: string }) {
      launched.push(request)
      for (const event of events) yield event
    },
  } as unknown as EngineClient

  const notify = (message: string): void => void notices.push(message)
  return new Expand({
    app,
    engine,
    withEngine: async action => (online ? action() : void notices.push(OFFLINE_NOTICE)),
    notify,
    markOffline: () => {},
    surface,
    notes: new OutputNotes({ app, notify, folder: () => 'chains/runs', engineUrl: () => ENGINE_URL }),
    newProposalId: () => `p-${++proposalIds}`,
  })
}

/**
 * Everything the picker's fire-and-forget callback goes on to do. The run is a
 * chain of resolved promises and nothing else, so draining the microtask queue
 * runs it to the end.
 */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 500; tick++) await Promise.resolve()
}

/** Runs the command through to the end, answering the chain picker with `pick`. */
async function expandWith(pick = 0): Promise<void> {
  const expand = makeExpand()
  await expand.start()
  lastModal()?.choose(pick)
  await settle()
}

/** One proposal's stamp, as the drawing hands it back. */
const stamp = (over: Partial<ProposalData> = {}): ProposalData => ({
  proposalId: 'p-1',
  role: 'accept',
  chainName: 'Five Personas',
  runId: RUN_ID,
  notePath: OPTIMIST,
  ...over,
})

/** The element a click carries. */
const clicked = (over: Partial<ProposalData>): { customData: { chainRunnerProposal: ProposalData } } => ({
  customData: { chainRunnerProposal: stamp(over) },
})

beforeEach(() => {
  resetModals()
  block = {
    id: 'block-7',
    box: { x: 100, y: 200, width: 240, height: 80 },
    input: { kind: 'text', text: 'ship it monday' },
    drawing: 'boards/wall.excalidraw.md',
  }
  events = finishes()
  capabilities = { runLayoutFrames: true, runStartEvent: true, runFailureFrame: true }
  chains = [personas]
  online = true
  launched = []
  notices = []
  placed = []
  edits = []
  selectedProposal = undefined
  editable = true
  vault = {}
  folders = []
  trashed = []
  proposalIds = 0
})

describe('choosing what to expand with', () => {
  it('asks which chain rather than naming one', async () => {
    await makeExpand().start()
    expect(lastModal()?.placeholder).toBe('Expand this block with which chain?')
  })

  it('runs the chain the reader picked, seeded from the block', async () => {
    await expandWith()
    expect(launched).toEqual([{ chainName: 'Five Personas', seedPrompt: 'ship it monday' }])
  })

  it('seeds from the note when the block is an embedded one', async () => {
    vault['notes/idea.md'] = '---\ntags: [x]\n---\nthe note body'
    block!.input = { kind: 'note', linkpath: 'notes/idea' }
    await expandWith()
    expect(launched[0]!.seedPrompt).toBe('the note body')
  })

  it('asks for the chain’s dropdown before running', async () => {
    chains = [{ ...personas, parameter: { name: 'audience', options: ['engineers', 'execs'] } }]
    const expand = makeExpand()
    await expand.start()
    lastModal()!.choose(0)
    expect(lastModal()!.placeholder).toBe('Choose audience')
    lastModal()!.choose(1)
    await settle()
    expect(launched[0]!.paramValue).toBe('execs')
  })
})

describe('what stops an expansion before it starts', () => {
  it('asks for one block when nothing readable is selected', async () => {
    block = undefined
    await makeExpand().start()
    expect(notices).toEqual([SELECT_ONE_BLOCK])
    expect(lastModal()).toBeUndefined()
  })

  it('says nothing was written when the block says nothing', async () => {
    block!.input = { kind: 'text', text: '   ' }
    await expandWith()
    expect(notices).toContain(NOTHING_TO_EXPAND)
    expect(launched).toEqual([])
  })

  it('runs a chain that pins its own files even so', async () => {
    chains = [{ ...personas, seeded: false }]
    block!.input = { kind: 'text', text: '' }
    await expandWith()
    expect(launched).toHaveLength(1)
  })

  it('is a notice and nothing when the engine is offline', async () => {
    online = false
    await makeExpand().start()
    expect(notices).toEqual([OFFLINE_NOTICE])
    expect(lastModal()).toBeUndefined()
  })

  it('refuses an engine that cannot stream outputs', async () => {
    capabilities = { runLayoutFrames: true }
    await makeExpand().start()
    expect(notices).toEqual([UNSUPPORTED_STREAMING])
  })

  it('says so when the workspace holds no chains', async () => {
    chains = []
    await makeExpand().start()
    expect(notices).toEqual([NO_CHAINS])
  })

  it('will not expand the same block twice at once', async () => {
    const expand = makeExpand()
    await expand.start()
    lastModal()!.choose(0)
    await expand.start()
    lastModal()!.choose(0)
    await settle()
    expect(notices).toContain(ALREADY_EXPANDING)
    expect(launched).toHaveLength(1)
  })
})

describe('what lands on the drawing', () => {
  it('says which chain is running before it does', async () => {
    await expandWith()
    expect(notices[0]).toBe(EXPANDING('Five Personas'))
  })

  it('places one proposal per declared output, connected to the block', async () => {
    await expandWith()
    expect(placed).toHaveLength(1)
    expect(placed[0]!.sourceId).toBe('block-7')
    expect(placed[0]!.proposals.map(one => one.note.path)).toEqual([OPTIMIST, SKEPTIC])
  })

  it('gives each proposal its own identity and the note behind it', async () => {
    await expandWith()
    const identities = placed[0]!.proposals.map(one => one.identity)
    expect(identities.map(one => one.proposalId)).toEqual(['p-1', 'p-2'])
    expect(identities.map(one => one.notePath)).toEqual([OPTIMIST, SKEPTIC])
    expect(identities.every(one => one.runId === RUN_ID)).toBe(true)
  })

  it('places them once, not once per frame', async () => {
    await expandWith()
    expect(placed).toHaveLength(1)
  })

  it('writes each output note with its provenance', async () => {
    await expandWith()
    expect(vault[OPTIMIST]).toContain(`run: "${RUN_ID}"`)
    expect(vault[OPTIMIST]).toContain('chain: "Five Personas"')
    expect(vault[OPTIMIST]).toContain('output: "Optimist"')
    expect(vault[OPTIMIST]).toContain('Optimist said something')
  })

  it('says so when the run produced no panels at all', async () => {
    events = [{ type: 'run_start', runId: RUN_ID }, { type: 'run_complete', runId: RUN_ID }]
    await expandWith()
    expect(notices).toContain(NO_PROPOSALS)
    expect(placed).toEqual([])
  })

  it('passes the engine’s failure on and writes nothing more', async () => {
    events = [{ type: 'run_start', runId: RUN_ID }, { type: 'error', error: 'the model refused' }]
    await expandWith()
    expect(notices).toContain('the model refused')
  })
})

describe('keeping and dropping a proposal', () => {
  it('claims a click on its own labels and lets the reader’s links through', () => {
    const expand = makeExpand()
    expect(expand.handleLinkClick(clicked({ role: 'accept' }))).toBe(false)
    expect(expand.handleLinkClick(clicked({ role: 'dismiss' }))).toBe(false)
    expect(expand.handleLinkClick({ customData: undefined })).toBe(true)
  })

  it('lets a click on the card open the note it shows', () => {
    expect(makeExpand().handleLinkClick(clicked({ role: 'card' }))).toBe(true)
  })

  it('normalises a kept proposal and keeps its note', async () => {
    vault[OPTIMIST] = 'the optimist said something'
    makeExpand().handleLinkClick(clicked({ role: 'accept' }))
    await settle()
    expect(edits).toEqual([{ proposalId: 'p-1', action: 'accept' }])
    expect(trashed).toEqual([])
    expect(vault[OPTIMIST]).toBeDefined()
  })

  it('takes a dropped proposal off the drawing and trashes its note', async () => {
    vault[OPTIMIST] = 'the optimist said something'
    makeExpand().handleLinkClick(clicked({ role: 'dismiss' }))
    await settle()
    expect(edits).toEqual([{ proposalId: 'p-1', action: 'dismiss' }])
    expect(trashed).toEqual([OPTIMIST])
  })

  it('decides the selected proposal from the palette, with no modifier key', async () => {
    selectedProposal = stamp({ role: 'card' })
    vault[OPTIMIST] = 'the optimist said something'
    await makeExpand().decideSelected('dismiss')
    expect(edits).toEqual([{ proposalId: 'p-1', action: 'dismiss' }])
    expect(trashed).toEqual([OPTIMIST])
  })

  it('keeps the note when the palette keeps the selected proposal', async () => {
    selectedProposal = stamp({ role: 'card' })
    vault[OPTIMIST] = 'the optimist said something'
    await makeExpand().decideSelected('accept')
    expect(edits).toEqual([{ proposalId: 'p-1', action: 'accept' }])
    expect(trashed).toEqual([])
  })

  it('asks for a proposal when the palette command finds none selected', async () => {
    await makeExpand().decideSelected('accept')
    expect(notices).toEqual([SELECT_A_PROPOSAL])
    expect(edits).toEqual([])
  })

  it('keeps the note when the drawing no longer has the proposal', async () => {
    editable = false
    vault[OPTIMIST] = 'the optimist said something'
    makeExpand().handleLinkClick(clicked({ role: 'dismiss' }))
    await settle()
    expect(notices).toEqual([PROPOSAL_GONE])
    expect(trashed).toEqual([])
  })
})
