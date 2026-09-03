import { describe, it, expect, beforeEach } from 'vitest'
import { ALREADY_RUNNING, MISSING_NOTE, NO_INPUTS, NodeRun, NOTHING_WRITTEN, SOME_UNBOUND } from '@/ui/nodeRun'
import { runLabel, type NodeRunStatus } from '@/ui/chainNode'
import type { NodeReading, NodeSurface } from '@/ui/excalidraw'
import { OutputNotes } from '@/ui/outputNotes'
import type { RunFrame } from '@/run/runFrame'
import type { EngineClient } from '@/engine/client'
import { EngineOfflineError } from '@/engine/transport'
import type { ChainSummary, RunEvent } from '@/engine/types'
import type { App } from 'obsidian'
import { TFile as StubFile, TFolder } from './obsidian'

/**
 * The seam a run on a drawing lives in: what is checked before anything is
 * launched, what the node says while it runs, and what is left on the drawing
 * when it settles.
 *
 * The three decisions underneath are pure and checked on their own —
 * `nodeScene.test.ts` for what is bound in, `runFrame.test.ts` for where it
 * lands, and the engine's own repo for what a panel is. This is the order they
 * happen in.
 */

const relay: ChainSummary = { slug: 'relay', name: 'Relay', view: 'timeline', seeded: true }

const nodeData = {
  nodeId: 'n-1',
  role: 'run' as const,
  chain: 'relay',
  chainName: 'Relay',
}

/** The scene as the surface reads it back: one text block bound in, nothing unbound. */
let reading: NodeReading | undefined
let events: RunEvent[]
let launchError: unknown
let capabilities: { runLayoutFrames?: boolean }
let chains: ChainSummary[]
let online: boolean

let launched: { chainName: string; seedPrompt: string; paramValue?: string }[]
let notices: string[]
let labels: string[]
let framed: { frame: RunFrame; notes: (string | undefined)[] }[]
let vault: Record<string, string>
let folders: string[]
let offline: number

const file = (path: string): StubFile => {
  const stub = new StubFile()
  stub.path = path
  stub.name = path.slice(path.lastIndexOf('/') + 1)
  stub.basename = stub.name.replace(/\.md$/, '')
  return stub
}

/** The engine's own layout frame: `n` panels, the first `done` of them settled. */
const layout = (names: string[], done: number): RunEvent => ({
  type: 'layout',
  model: {
    kind: 'timeline',
    panels: names.map((name, index) => ({
      name,
      node: name.toLowerCase(),
      text: index < done ? `${name} said something` : '',
      lines: index < done ? 1 : 0,
      state: index < done ? ('filled' as const) : ('pending' as const),
      ...(index === names.length - 1 ? { emphasis: 'last' as const } : {}),
    })),
  },
})

function makeRun(): NodeRun {
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => {
        if (vault[path] !== undefined) return file(path)
        if (folders.includes(path)) {
          const folder = new TFolder()
          folder.path = path
          return folder
        }
        return null
      },
      cachedRead: (target: { path: string }) => Promise.resolve(vault[target.path] ?? ''),
      create: (path: string, content: string) => {
        vault[path] = content
        return Promise.resolve(file(path))
      },
      createFolder: (path: string) => {
        folders.push(path)
        return Promise.resolve(undefined)
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
    read: () => reading,
    setRunStatus: (_target, status) => {
      labels.push(runLabel(status))
      return Promise.resolve(true)
    },
    placeRun: (frame, notes) => {
      framed.push({ frame, notes: notes.map(note => note?.path) })
      return Promise.resolve()
    },
  }

  const engine = {
    loadWorkspace: () => Promise.resolve({ chains, capabilities }),
    launchRun: async function* (request: { chainName: string; seedPrompt: string; paramValue?: string }) {
      launched.push(request)
      if (launchError) throw launchError
      for (const event of events) yield event
    },
  } as unknown as EngineClient

  const notify = (message: string): void => void notices.push(message)
  return new NodeRun({
    app,
    engine,
    withEngine: async action => (online ? action() : undefined),
    notify,
    markOffline: () => void offline++,
    surface,
    notes: new OutputNotes({ app, notify, folder: () => 'chains/runs' }),
    chainGone: name => `${name} is gone`,
    nodeGone: 'that node is gone',
    unsupportedEngine: 'this engine is too old',
  })
}

/** A run of a chain that finishes with two panels and an id. */
const finishes = (): RunEvent[] => [
  layout(['First', 'Survivor'], 0),
  layout(['First', 'Survivor'], 1),
  layout(['First', 'Survivor'], 2),
  { type: 'run_complete', runId: '2026-09-02-ab12c' },
]

const start = (): Promise<void> => makeRun().run(nodeData, { groupIds: ['g-1'] })

beforeEach(() => {
  reading = {
    box: { x: 100, y: 200, width: 300, height: 140 },
    inputs: { inputs: [{ kind: 'text', text: 'a premise' }], unbound: 0 },
    drawing: 'boards/wall.excalidraw.md',
  }
  events = finishes()
  launchError = undefined
  capabilities = { runLayoutFrames: true }
  chains = [relay]
  online = true
  launched = []
  notices = []
  labels = []
  framed = []
  vault = {}
  folders = []
  offline = 0
})

describe('what the run is given', () => {
  it('sends what is bound into the node, in reading order', async () => {
    reading!.inputs.inputs = [
      { kind: 'text', text: 'a premise' },
      { kind: 'note', linkpath: 'notes/second' },
    ]
    vault['notes/second.md'] = '---\ntags: [x]\n---\nthe note body'

    await start()
    expect(launched[0].seedPrompt).toBe('a premise\n\nthe note body')
    expect(launched[0].chainName).toBe('Relay')
  })

  it('sends the node’s own dropdown pick', async () => {
    await makeRun().run({ ...nodeData, parameterName: 'audience', parameterValue: 'engineers' }, {})
    expect(launched[0].paramValue).toBe('engineers')
  })

  it('refuses a chain that reads a seed when nothing is bound in', async () => {
    reading!.inputs = { inputs: [], unbound: 0 }
    await start()
    expect(notices).toEqual([NO_INPUTS])
    expect(launched).toEqual([])
  })

  it('runs a chain that pins its own files with nothing bound in', async () => {
    chains = [{ ...relay, seeded: false }]
    reading!.inputs = { inputs: [], unbound: 0 }
    await start()
    expect(launched[0].seedPrompt).toBe('')
  })

  it('says which arrows it could not read, and runs on the rest', async () => {
    reading!.inputs = { inputs: [{ kind: 'text', text: 'a premise' }], unbound: 2 }
    await start()
    expect(notices).toContain(SOME_UNBOUND(2))
    expect(launched[0].seedPrompt).toBe('a premise')
  })

  it('says so when an embedded note has left the vault', async () => {
    reading!.inputs = { inputs: [{ kind: 'note', linkpath: 'notes/gone' }], unbound: 0 }
    await start()
    expect(notices).toContain(MISSING_NOTE('notes/gone'))
    expect(launched).toEqual([])
  })
})

describe('what the node says', () => {
  it('counts the panels that have landed, out of the panels declared', async () => {
    await start()
    expect(labels).toEqual([
      runLabel({ kind: 'running', done: 0 }),
      runLabel({ kind: 'running', done: 0, total: 2 }),
      runLabel({ kind: 'running', done: 1, total: 2 }),
      runLabel({ kind: 'running', done: 2, total: 2 }),
      runLabel({ kind: 'done' }),
    ])
  })

  it('says nothing twice: a frame that changes no count is not a write', async () => {
    events = [layout(['First', 'Survivor'], 0), layout(['First', 'Survivor'], 0), ...finishes().slice(1)]
    const running = labels.filter(label => label === runLabel({ kind: 'running', done: 0, total: 2 }))
    await start()
    expect(running.length).toBeLessThanOrEqual(1)
  })

  it('shows failed, and the engine’s own message, when a hop fails', async () => {
    events = [
      layout(['First'], 0),
      {
        type: 'agent_done',
        agentName: 'First',
        nodeId: 'first',
        step: 1,
        output: { agentName: 'First', output: '', status: 'error', error: 'the model refused', timestamp: '' },
      },
      layout(['First'], 1),
      { type: 'run_complete', runId: '2026-09-02-ab12c' },
    ]
    await start()
    expect(labels.at(-1)).toBe(runLabel({ kind: 'failed' }))
    expect(notices).toContain('the model refused')
  })

  it('shows failed when the run never reported an id', async () => {
    events = [layout(['First'], 1)]
    await start()
    expect(labels.at(-1)).toBe(runLabel({ kind: 'failed' }))
    expect(notices).toContain(NOTHING_WRITTEN)
  })

  it('will not start a second run on a node already running', async () => {
    const runner = makeRun()
    const first = runner.run(nodeData, {})
    await runner.run(nodeData, {})
    await first
    expect(notices).toContain(ALREADY_RUNNING)
    expect(launched.length).toBe(1)
  })
})

describe('what the run leaves behind', () => {
  it('writes every output as a note under the run’s own folder', async () => {
    await start()
    expect(Object.keys(vault).sort()).toEqual([
      'chains/runs/2026-09-02-ab12c/First.md',
      'chains/runs/2026-09-02-ab12c/Survivor.md',
    ])
    const note = vault['chains/runs/2026-09-02-ab12c/First.md']
    expect(note).toContain('run: "2026-09-02-ab12c"')
    expect(note).toContain('chain: "Relay"')
    expect(note).toContain('output: "First"')
    expect(note).toContain('First said something')
  })

  it('places a frame named for the chain and the run, holding one embeddable per output', async () => {
    await start()
    expect(framed).toHaveLength(1)
    expect(framed[0].frame.name).toBe('Relay · 2026-09-02-ab12c')
    expect(framed[0].notes).toEqual([
      'chains/runs/2026-09-02-ab12c/First.md',
      'chains/runs/2026-09-02-ab12c/Survivor.md',
    ])
  })

  it('puts the frame beside the node it was run from', async () => {
    await start()
    expect(framed[0].frame.box.x).toBeGreaterThan(reading!.box.x + reading!.box.width)
    expect(framed[0].frame.box.y).toBe(reading!.box.y)
  })
})

describe('what stops a run', () => {
  it('writes nothing when the engine is offline', async () => {
    online = false
    await start()
    expect(launched).toEqual([])
    expect(vault).toEqual({})
    expect(framed).toEqual([])
    expect(labels).toEqual([])
  })

  it('writes nothing when the engine drops mid-run, and says so', async () => {
    launchError = new EngineOfflineError('http://localhost:3000')
    await start()
    expect(vault).toEqual({})
    expect(framed).toEqual([])
    expect(offline).toBe(1)
    expect(labels.at(-1)).toBe(runLabel({ kind: 'failed' }))
  })

  it('refuses an engine that does not project its own panels', async () => {
    capabilities = {}
    await start()
    expect(notices).toEqual(['this engine is too old'])
    expect(launched).toEqual([])
  })

  it('says so when the node names a chain the workspace no longer has', async () => {
    chains = []
    await start()
    expect(notices).toEqual(['Relay is gone'])
  })

  it('says so when the node has left the drawing', async () => {
    reading = undefined
    await start()
    expect(notices).toEqual(['that node is gone'])
    expect(launched).toEqual([])
  })
})

describe('runLabel', () => {
  const label = (status: NodeRunStatus): string => runLabel(status)

  it('keeps Run on the line once the run has settled', () => {
    expect(label({ kind: 'done' })).toContain('▶ Run')
    expect(label({ kind: 'failed' })).toContain('▶ Run')
  })

  it('counts steps once the engine has said how many there are', () => {
    expect(label({ kind: 'running', done: 2, total: 5 })).toContain('2/5')
    expect(label({ kind: 'running', done: 0 })).not.toContain('/')
  })
})
