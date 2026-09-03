import { describe, it, expect, beforeEach } from 'vitest'
import {
  ALREADY_RUNNING,
  MISSING_NOTE,
  NO_FRAME,
  NO_INPUTS,
  NO_OUTPUTS,
  NodeRun,
  NOTHING_WRITTEN,
  SOME_UNBOUND,
} from '@/ui/nodeRun'
import { CHAIN_GONE, NODE_GONE } from '@/ui/chainNodes'
import { UNSUPPORTED_STREAMING } from '@/run/stream'
import { OFFLINE_NOTICE } from '@/engine/guard'
import { runLabel, type NodeRunStatus } from '@/ui/chainNode'
import type { NodeReading, NodeSurface } from '@/ui/excalidraw'
import { OutputNotes } from '@/ui/outputNotes'
import type { RunFrame } from '@/run/runFrame'
import type { EngineClient } from '@/engine/client'
import { EngineOfflineError } from '@/engine/transport'
import type { Capabilities, ChainSummary, RunEvent } from '@/engine/types'
import type { App } from 'obsidian'
import { TFile as StubFile, TFolder } from './obsidian'

/**
 * The seam a run on a drawing lives in: what is checked before anything is
 * launched, what the node says while it runs, and what the outputs do as they
 * fill.
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

const RUN_ID = '2026-09-02-ab12c'
const FIRST = `chains/runs/${RUN_ID}/First.md`
const SURVIVOR = `chains/runs/${RUN_ID}/Survivor.md`

let reading: NodeReading | undefined
let events: RunEvent[]
let launchError: unknown
let capabilities: Capabilities
let chains: ChainSummary[]
let online: boolean

let launched: { chainName: string; seedPrompt: string; paramValue?: string }[]
let notices: string[]
let labels: string[]
let framed: { frame: RunFrame; notes: string[] }[]
let vault: Record<string, string>
let folders: string[]
let offline: number
/** Whether this Excalidraw can make a real frame. */
let canFrame: boolean
/** Every vault write, so the cadence of the streaming flush is visible. */
let writes: string[]
/** What the vault held after each event of the stream was handled. */
let duringRun: Record<string, string>[]

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

/** The final frame a failed run sends: everything still pending moved to errored. */
const failureFrame = (names: string[], done: number, error: string): RunEvent => ({
  type: 'layout',
  model: {
    kind: 'timeline',
    panels: names.map((name, index) => ({
      name,
      node: name.toLowerCase(),
      text: index < done ? `${name} said something` : '',
      lines: index < done ? 1 : 0,
      state: index < done ? ('filled' as const) : ('errored' as const),
      ...(index < done ? {} : { error }),
    })),
  },
})

/** A columns layout whose converging panel is declared first, not last. */
const joinFirst = (done: number): RunEvent => ({
  type: 'layout',
  model: {
    kind: 'columns',
    panels: [
      {
        name: 'Synthesis',
        node: 'synthesis',
        text: done > 1 ? 'the synthesis' : '',
        lines: done > 1 ? 1 : 0,
        state: done > 1 ? ('filled' as const) : ('pending' as const),
        emphasis: 'join' as const,
      },
      {
        name: 'Optimist',
        node: 'optimist',
        text: done > 0 ? 'the optimist' : '',
        lines: done > 0 ? 1 : 0,
        state: done > 0 ? ('filled' as const) : ('pending' as const),
      },
    ],
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
        writes.push(path)
        return Promise.resolve(file(path))
      },
      modify: (target: { path: string }, content: string) => {
        vault[target.path] = content
        writes.push(target.path)
        return Promise.resolve()
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
    placeRun: (frame, outputs) => {
      framed.push({ frame, notes: outputs.map(output => output.note.path) })
      return Promise.resolve(canFrame)
    },
  }

  const engine = {
    loadWorkspace: () => Promise.resolve({ chains, capabilities }),
    launchRun: async function* (request: { chainName: string; seedPrompt: string; paramValue?: string }) {
      launched.push(request)
      if (launchError) throw launchError
      for (const event of events) {
        yield event
        // What the vault held once the plugin had finished with that event.
        duringRun.push({ ...vault })
      }
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
  })
}

/** A run that names itself, declares two outputs, fills both and completes. */
const finishes = (): RunEvent[] => [
  { type: 'run_start', runId: RUN_ID },
  layout(['First', 'Survivor'], 0),
  layout(['First', 'Survivor'], 1),
  layout(['First', 'Survivor'], 2),
  { type: 'run_complete', runId: RUN_ID },
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
  capabilities = { runLayoutFrames: true, runStartEvent: true, runFailureFrame: true }
  chains = [relay]
  online = true
  launched = []
  notices = []
  labels = []
  framed = []
  canFrame = true
  vault = {}
  folders = []
  offline = 0
  writes = []
  duringRun = []
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

describe('outputs that fill in place', () => {
  it('opens every output and places the frame on the first frame that names them', async () => {
    await start()
    // The second event is the first layout frame; by the end of it both notes
    // exist and the frame is on the drawing, with nothing written in them yet.
    expect(Object.keys(duringRun[1]).sort()).toEqual([FIRST, SURVIVOR])
    expect(duringRun[1][FIRST]).toContain(`run: "${RUN_ID}"`)
    expect(duringRun[1][FIRST]).not.toContain('said something')
    expect(framed).toHaveLength(1)
  })

  it('fills each note as its own hop lands, before the run is over', async () => {
    await start()
    // Third event: the first hop has landed and the second has not.
    expect(duringRun[2][FIRST]).toContain('First said something')
    expect(duringRun[2][SURVIVOR]).not.toContain('said something')
  })

  it('places the frame once, however many frames arrive', async () => {
    await start()
    expect(framed).toHaveLength(1)
    expect(framed[0].frame.name).toBe(`Relay · ${RUN_ID}`)
    expect(framed[0].notes).toEqual([FIRST, SURVIVOR])
  })

  it('does not write a note per token', async () => {
    events = [
      { type: 'run_start', runId: RUN_ID },
      layout(['First'], 0),
      { type: 'token', nodeId: 'first', token: 'a' },
      { type: 'token', nodeId: 'first', token: 'b' },
      { type: 'token', nodeId: 'first', token: 'c' },
      layout(['First'], 1),
      { type: 'run_complete', runId: RUN_ID },
    ]
    await start()
    // One create, and one write when the hop lands. The three tokens add no
    // line, so they cost the vault nothing.
    expect(writes.filter(path => path === `chains/runs/${RUN_ID}/First.md`)).toHaveLength(2)
  })

  it('writes a partial that has reached a new line, so the reader sees it fill', async () => {
    events = [
      { type: 'run_start', runId: RUN_ID },
      layout(['First'], 0),
      { type: 'token', nodeId: 'first', token: 'a line\nand another' },
      { type: 'run_complete', runId: RUN_ID },
    ]
    await start()
    expect(duringRun[2][`chains/runs/${RUN_ID}/First.md`]).toContain('and another')
  })

  it('keeps two outputs of one name as two notes', async () => {
    events = [
      { type: 'run_start', runId: RUN_ID },
      layout(['Same', 'Same'], 2),
      { type: 'run_complete', runId: RUN_ID },
    ]
    await start()
    expect(Object.keys(vault).sort()).toEqual([
      `chains/runs/${RUN_ID}/Same 2.md`,
      `chains/runs/${RUN_ID}/Same.md`,
    ])
  })

  it('fills each note from its own panel when the join is not declared last', async () => {
    // The frame draws branches before the panel they converge on, so the frame's
    // order is not the engine's. Following a panel by its place in the frame
    // would give every note its neighbour's words.
    events = [
      { type: 'run_start', runId: RUN_ID },
      joinFirst(0),
      joinFirst(2),
      { type: 'run_complete', runId: RUN_ID },
    ]
    await start()

    const optimist = vault[`chains/runs/${RUN_ID}/Optimist.md`]
    const synthesis = vault[`chains/runs/${RUN_ID}/Synthesis.md`]
    expect(optimist).toContain('output: "Optimist"')
    expect(optimist).toContain('the optimist')
    expect(optimist).not.toContain('the synthesis')
    expect(synthesis).toContain('output: "Synthesis"')
    expect(synthesis).toContain('the synthesis')
  })

  it('writes each output with its own provenance', async () => {
    await start()
    expect(vault[FIRST]).toContain(`run: "${RUN_ID}"`)
    expect(vault[FIRST]).toContain('chain: "Relay"')
    expect(vault[FIRST]).toContain('output: "First"')
    expect(vault[FIRST]).toContain('First said something')
  })

  it('says so when this Excalidraw could not make a frame, and still places the outputs', async () => {
    canFrame = false
    await start()
    expect(notices).toContain(NO_FRAME)
    expect(framed[0].notes).toHaveLength(2)
  })

  it('puts the frame beside the node it was run from', async () => {
    await start()
    expect(framed[0].frame.box.x).toBeGreaterThan(reading!.box.x + reading!.box.width)
    expect(framed[0].frame.box.y).toBe(reading!.box.y)
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

  it('carries the engine’s own message onto the node when a hop fails', async () => {
    events = [
      { type: 'run_start', runId: RUN_ID },
      layout(['First'], 0),
      failureFrame(['First'], 0, 'the model refused'),
      { type: 'error', error: 'the model refused' },
    ]
    await start()
    // The notice is gone by the time the reader looks back at the drawing, so the
    // reason has to be on the node as well as in the notice.
    expect(labels.at(-1)).toContain('the model refused')
    expect(labels.at(-1)).toBe(runLabel({ kind: 'failed', error: 'the model refused' }))
    expect(notices).toContain('the model refused')
  })

  it('says the run is done when it finished having produced nothing', async () => {
    events = [
      { type: 'run_start', runId: RUN_ID },
      { type: 'run_complete', runId: RUN_ID },
    ]
    await start()
    expect(labels.at(-1)).toBe(runLabel({ kind: 'done' }))
    expect(notices).toContain(NO_OUTPUTS)
    expect(framed).toEqual([])
  })

  it('shows failed when the run never reported an id', async () => {
    events = [layout(['First'], 1)]
    await start()
    expect(labels.at(-1)).toBe(runLabel({ kind: 'failed' }))
    expect(notices).toContain(NOTHING_WRITTEN)
    expect(vault).toEqual({})
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

describe('a run that dies before a hop', () => {
  const died = 'no API key for the provider'

  beforeEach(() => {
    events = [
      { type: 'run_start', runId: RUN_ID },
      layout(['First', 'Survivor'], 0),
      failureFrame(['First', 'Survivor'], 0, died),
      { type: 'error', error: died },
    ]
  })

  it('leaves a note per declared output, each saying why there is nothing', async () => {
    await start()
    expect(Object.keys(vault).sort()).toEqual([FIRST, SURVIVOR])
    expect(vault[FIRST]).toContain(`> ${died}`)
    expect(vault[SURVIVOR]).toContain(`> ${died}`)
  })

  it('says failed on the node, with the engine’s words', async () => {
    await start()
    expect(labels.at(-1)).toBe(runLabel({ kind: 'failed', error: died }))
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

  it('writes nothing when the engine drops before the run is named, and says so', async () => {
    launchError = new EngineOfflineError('http://localhost:3000')
    await start()
    expect(vault).toEqual({})
    expect(framed).toEqual([])
    expect(offline).toBe(1)
    // The node carries why, not just that: a notice is gone the moment it fades.
    expect(labels.at(-1)).toBe(runLabel({ kind: 'failed', error: OFFLINE_NOTICE }))
  })

  it('refuses an engine that cannot name a run before its first hop', async () => {
    capabilities = { runLayoutFrames: true, runFailureFrame: true }
    await start()
    expect(notices).toEqual([UNSUPPORTED_STREAMING])
    expect(launched).toEqual([])
  })

  it('refuses an engine that sends no final frame when a run fails', async () => {
    capabilities = { runLayoutFrames: true, runStartEvent: true }
    await start()
    expect(notices).toEqual([UNSUPPORTED_STREAMING])
    expect(launched).toEqual([])
  })

  it('says so when the node names a chain the workspace no longer has', async () => {
    chains = []
    await start()
    expect(notices).toEqual([CHAIN_GONE('Relay')])
  })

  it('says so when the node has left the drawing', async () => {
    reading = undefined
    await start()
    expect(notices).toEqual([NODE_GONE])
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
