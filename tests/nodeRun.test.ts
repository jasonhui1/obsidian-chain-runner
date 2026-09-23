import { describe, it, expect, beforeEach } from 'vitest'
import {
  ALREADY_RUNNING,
  NO_FRAME,
  NO_INPUTS,
  NO_OUTPUTS,
  NodeRun,
  NOTHING_WRITTEN,
  PICK_A_CHAIN,
  SOME_UNBOUND,
  INVALID_RUN_COUNT,
  VARIANCE_UNSUPPORTED,
} from '@/ui/nodeRun'
import type { ChainNodeData } from '@/ui/chainNode'
import { MISSING_NOTE } from '@/ui/inputSeed'
import { CHAIN_GONE, NODE_GONE } from '@/ui/chainNodes'
import { UNSUPPORTED_STREAMING } from '@/run/stream'
import { OFFLINE_NOTICE } from '@/engine/guard'
import { runLabel, type NodeRunStatus } from '@/ui/chainNode'
import type { DrawingView, NodeReading, RunSurface } from '@/ui/excalidraw'
import { OutputNotes } from '@/ui/outputNotes'
import type { RunFrame } from '@/run/runFrame'
import type { EngineClient } from '@/engine/client'
import { EngineOfflineError } from '@/engine/transport'
import type { Capabilities, ChainSummary, RunEvent, VarianceRequest, VarianceRunEvent } from '@/engine/types'
import { MemoryNoteStore } from './memoryNoteStore'

/** The order a run happens in. The pure pieces are checked in their own files. */

const relay: ChainSummary = { slug: 'relay', name: 'Relay', view: 'timeline', seeded: true }

const nodeData = {
  nodeId: 'n-1',
  role: 'run' as const,
  chain: 'relay',
  chainName: 'Relay',
}

/** The engine an output note links back to; the run view is checked in `provenance.test.ts`. */
const ENGINE_URL = 'http://localhost:3000'

const RUN_ID = '2026-09-02-ab12c'
const SECOND_RUN_ID = '2026-09-02-cd34e'
const FIRST = `chains/runs/${RUN_ID}/First.md`
const SURVIVOR = `chains/runs/${RUN_ID}/Survivor.md`

let reading: NodeReading | undefined
let events: RunEvent[]
let varianceEvents: VarianceRunEvent[]
/** Each hold the run reached, as the node run handed it on. */
let held: string[]
let launchError: unknown
let capabilities: Capabilities
let chains: ChainSummary[]
let online: boolean
let upgradedRunCounts: boolean
let upgradedAtRead: boolean

let launched: { chainName: string; seedPrompt: string; paramValue?: string }[]
let varianceRequests: VarianceRequest[]
let notices: string[]
let labels: string[]
let framed: { frame: RunFrame; notes: string[] }[]
let store: MemoryNoteStore
let vault: Record<string, string>
let offline: number
/** Whether this Excalidraw can make a real frame. */
let canFrame: boolean
/** Each view a run bound its drawing on. */
let boundOn: (DrawingView | undefined)[]
/** Why the drawing cannot be bound, when it cannot. */
let unbindable: string | undefined
/** Set once the drawing has closed: every write after it throws. */
let closed: string | undefined
/** Every vault write, so the cadence of the streaming flush is visible. */
let writes: string[]
/** What the vault held after each event of the stream was handled. */
let duringRun: Record<string, string>[]

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
  const surface: RunSurface = {
    unavailable: () => undefined,
    on: view => {
      boundOn.push(view)
      if (unbindable) throw new Error(unbindable)
      return {
        read: () => {
          upgradedAtRead = upgradedRunCounts
          return reading
        },
        upgradeRunCounts: () => {
          upgradedRunCounts = true
          return Promise.resolve(false)
        },
        setRunStatus: (_target, status) => {
          if (closed) return Promise.reject(new Error(closed))
          labels.push(runLabel(status))
          return Promise.resolve(true)
        },
        placeRun: (frame, outputs) => {
          framed.push({ frame, notes: outputs.map(output => output.notePath) })
          return Promise.resolve(canFrame)
        },
      }
    },
  }

  const engine = {
    capabilities: () => Promise.resolve(capabilities),
    listChains: () => Promise.resolve(chains),
    launchRun: async function* (request: { chainName: string; seedPrompt: string; paramValue?: string }) {
      launched.push(request)
      if (launchError) throw launchError
      for (const event of events) {
        yield event
        // What the vault held once the plugin had finished with that event.
        duringRun.push({ ...vault })
      }
    },
    launchVariance: async function* (request: VarianceRequest) {
      varianceRequests.push(request)
      for (const event of varianceEvents) yield event
    },
  } as unknown as EngineClient

  const notify = (message: string): void => void notices.push(message)
  return new NodeRun({
    store,
    engine,
    withEngine: async action => (online ? action() : undefined),
    notify,
    markOffline: () => void offline++,
    holdReached: (runId, nodeId) => Promise.resolve(void held.push(`${runId} ${nodeId}`)),
    surface,
    notes: new OutputNotes({ store, notify, folder: () => 'chains/runs', engineUrl: () => ENGINE_URL }),
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

const HOLD = { nodeId: 'pick', input: '', candidates: [], reachedAt: 'now' }

const start = (data: ChainNodeData = nodeData, view?: DrawingView): Promise<void> =>
  makeRun().run(data, { groupIds: ['g-1'] }, view)

beforeEach(() => {
  reading = {
    box: { x: 100, y: 200, width: 300, height: 140 },
    inputs: { inputs: [{ kind: 'text', text: 'a premise' }], unbound: 0 },
    runCount: '1',
    drawing: 'boards/wall.excalidraw.md',
  }
  events = finishes()
  varianceEvents = []
  held = []
  launchError = undefined
  capabilities = { runLayoutFrames: true, runStartEvent: true, runFailureFrame: true }
  chains = [relay]
  online = true
  upgradedRunCounts = false
  upgradedAtRead = false
  launched = []
  varianceRequests = []
  notices = []
  labels = []
  framed = []
  canFrame = true
  boundOn = []
  unbindable = undefined
  closed = undefined
  store = new MemoryNoteStore()
  vault = store.notes
  offline = 0
  writes = []
  store.onChange(path => void writes.push(path))
  duringRun = []
})

describe('what the run is given', () => {
  it('upgrades the clicked view before reading the run count', async () => {
    const embedded = { file: null } as DrawingView
    await start(nodeData, embedded)

    expect(upgradedAtRead).toBe(true)
    expect(boundOn).toContain(embedded)
    expect(launched).toHaveLength(1)
  })

  it('binds the drawing once, on the click’s own view, for the whole run', async () => {
    const view = { file: null }
    await makeRun().run(nodeData, { groupIds: ['g-1'] }, view)
    expect(framed).toHaveLength(1)
    expect(labels.length).toBeGreaterThan(1)
    expect(boundOn).toEqual([view])
  })

  it('says why, and runs nothing, when there is no drawing to bind', async () => {
    unbindable = 'Open the Excalidraw drawing as its own tab to do that.'
    await start()
    expect(notices).toEqual([unbindable])
    expect(launched).toEqual([])
  })

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
    // By the end of the first layout frame both notes exist, still empty.
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
    // One create, one write when the hop lands, and the settled refresh; tokens add no writes.
    expect(writes.filter(path => path === `chains/runs/${RUN_ID}/First.md`)).toHaveLength(3)
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
    // The frame draws branches first, so its order is not the engine's.
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
  it('says once that the drawing closed, however many writes follow', async () => {
    closed = 'That drawing was closed, so nothing was written to it.'
    await start()
    expect(launched).toHaveLength(1)
    expect(notices.filter(one => one === closed)).toHaveLength(1)
    expect(framed).toEqual([])
  })

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

  it('hands on each hold a run reached, and says it is done', async () => {
    const waitingAt = (nodeId: string): RunEvent => ({ type: 'run_waiting', runId: RUN_ID, nodeId, hold: { ...HOLD, nodeId } })
    events = [...finishes().slice(0, -1), waitingAt('pick'), waitingAt('pick-2')]
    await start()
    expect(held).toEqual([`${RUN_ID} pick`, `${RUN_ID} pick-2`])
    expect(labels.at(-1)).toBe(runLabel({ kind: 'done' }))
  })

  it('hands on no hold for a run that completed', async () => {
    await start()
    expect(held).toEqual([])
  })

  it('carries the engine’s own message onto the node when a hop fails', async () => {
    events = [
      { type: 'run_start', runId: RUN_ID },
      layout(['First'], 0),
      failureFrame(['First'], 0, 'the model refused'),
      { type: 'error', error: 'the model refused' },
    ]
    await start()
    // The notice fades; the node has to keep the reason.
    expect(labels.at(-1)).toContain('the model refu')
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

describe('variance runs', () => {
  const member = (instance: number, event: RunEvent): VarianceRunEvent => ({ ...event, instance })

  beforeEach(() => {
    capabilities.varianceGroups = true
    varianceEvents = [
      member(0, { type: 'run_start', runId: RUN_ID }),
      member(1, { type: 'run_start', runId: SECOND_RUN_ID }),
      member(1, layout(['Second'], 0)),
      member(0, layout(['First'], 0)),
      member(1, layout(['Second'], 1)),
      member(0, layout(['First'], 1)),
      member(1, { type: 'run_complete', runId: SECOND_RUN_ID }),
      member(0, { type: 'run_complete', runId: RUN_ID }),
      { type: 'variance_complete', groupId: 'group-1', runIds: [RUN_ID, SECOND_RUN_ID] },
    ]
  })

  it('runs once by default without opening a count picker', async () => {
    await start()

    expect(launched).toHaveLength(1)
    expect(varianceRequests).toEqual([])
  })

  it.each([false, undefined])('keeps the direct single run when variance groups are %s', async capability => {
    capabilities.varianceGroups = capability
    await start()

    expect(launched).toHaveLength(1)
    expect(varianceRequests).toEqual([])
  })

  it('runs the count stored on the drawing with its inputs and dropdown, then places separate frames', async () => {
    reading!.runCount = '2'
    await start({ ...nodeData, parameterValue: 'engineers' })

    expect(launched).toEqual([])
    expect(varianceRequests).toEqual([
      { chainName: 'Relay', seedPrompt: 'a premise', paramValue: 'engineers', count: 2 },
    ])
    expect(framed.map(one => one.frame.name).sort()).toEqual([
      `Relay · ${RUN_ID}`,
      `Relay · ${SECOND_RUN_ID}`,
    ])
    expect(vault[`chains/runs/${RUN_ID}/First.md`]).toContain('First said something')
    expect(vault[`chains/runs/${SECOND_RUN_ID}/Second.md`]).toContain('Second said something')

    const stacked = [...framed].sort((left, right) => left.frame.box.y - right.frame.box.y)
    expect(stacked[0]?.frame.box.y).toBe(reading?.box.y)
    expect(stacked[0]!.frame.box.y + stacked[0]!.frame.box.height).toBeLessThanOrEqual(stacked[1]!.frame.box.y)
  })

  it('rejects a count that is not an integer from one through ten', async () => {
    reading!.runCount = '1.5'
    await start()

    expect(notices).toEqual([INVALID_RUN_COUNT])
    expect(launched).toEqual([])
    expect(varianceRequests).toEqual([])
  })

  it('refuses a count above one when the engine has no variance support', async () => {
    capabilities.varianceGroups = false
    reading!.runCount = '2'
    await start()

    expect(notices).toEqual([VARIANCE_UNSUPPORTED])
    expect(launched).toEqual([])
    expect(varianceRequests).toEqual([])
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

  it('says which line to click when the node has no chain yet', async () => {
    await makeRun().run({ ...nodeData, chain: '', chainName: '' }, { groupIds: ['g-1'] })
    expect(notices).toEqual([PICK_A_CHAIN])
    expect(launched).toEqual([])
  })

  it('says so when the node has left the drawing', async () => {
    reading = undefined
    await start()
    expect(notices).toEqual([NODE_GONE])
    expect(launched).toEqual([])
  })
})

describe('an output run again', () => {
  /** The same run, under a second id, so the two frames are told apart. */
  const SECOND_RUN = '2026-09-02-cd34e'
  const secondRun = (): RunEvent[] => [
    { type: 'run_start', runId: SECOND_RUN },
    layout(['First', 'Survivor'], 2),
    { type: 'run_complete', runId: SECOND_RUN },
  ]

  it('reads an output note as its seed, and lands in a frame of its own', async () => {
    await start()

    // The reader draws an arrow from the placed output into a second node.
    reading!.inputs = { inputs: [{ kind: 'note', linkpath: SURVIVOR }], unbound: 0 }
    events = secondRun()
    await start()

    // The note's provenance is the vault's bookkeeping, not the chain's argument.
    expect(launched[1].seedPrompt).toBe('Survivor said something')
    expect(framed.map(one => one.frame.name)).toEqual([`Relay · ${RUN_ID}`, `Relay · ${SECOND_RUN}`])
    expect(vault[`chains/runs/${SECOND_RUN}/Survivor.md`]).toContain('Survivor said something')
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
