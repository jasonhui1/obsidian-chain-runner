import { describe, it, expect, beforeEach, vi } from 'vitest'
import { QuickRunner } from '@/ui/quickRun'
import type { SeedChoice } from '@/ui/chainPicker'
import type { EngineClient } from '@/engine/client'
import type { RunEvent, VarianceGroup, VarianceRequest, VarianceRunEvent } from '@/engine/types'
import type { RunResult } from '@/run/session'
import type { App } from 'obsidian'
// The test-time `obsidian` stub, imported by path so `tsc` still checks the
// plugin against the real module's types.
import { lastModal, resetModals } from './obsidian'
import { MemoryNoteStore } from './memoryNoteStore'

/**
 * The seam between Obsidian and the run: which note the command reads, how much
 * of it, and what it asks before launching.
 */

const CHAINS = [
  { slug: 'relay', name: 'Telephone Relay' },
  { slug: 'lens', name: 'Through A Lens', parameter: { name: 'lens', options: ['sceptic', 'builder'] } },
  { slug: 'creative-director', name: 'creative-director', parameter: { name: 'experimental', options: ['3 - fresh'] } },
]

/** What the run was launched with, and every state the view was shown. */
let launched: { chainName: string; seedPrompt: string; paramValue?: string }[]
let varianceCapability: boolean | undefined
let varianceRequests: VarianceRequest[]
let varianceEvents: VarianceRunEvent[]
let varianceGroup: VarianceGroup
let progressShown: unknown[]
let groupsShown: VarianceGroup[]
let events: RunEvent[]
let held: string[]
let shown: RunResult[]
let sourcePaths: string[]
let notices: string[]
let store: MemoryNoteStore

function makeRunner(): QuickRunner {
  const engine = {
    capabilities: () => Promise.resolve({ runLayoutFrames: true, ...(varianceCapability === undefined ? {} : { varianceGroups: varianceCapability }) }),
    listChains: () => Promise.resolve(CHAINS),
    launchRun: async function* (request: { chainName: string; seedPrompt: string; paramValue?: string }) {
      launched.push(request)
      for (const event of events) yield event
    },
    launchVariance: async function* (request: VarianceRequest) {
      varianceRequests.push(request)
      for (const event of varianceEvents) yield event
    },
    getVarianceGroup: (groupId: string) => {
      expect(groupId).toBe(varianceGroup.groupId)
      return Promise.resolve(varianceGroup)
    },
  } as unknown as EngineClient

  return new QuickRunner({
    app: {} as App,
    store,
    engine,
    withEngine: action => action(),
    openResultView: () =>
      Promise.resolve({
        show: (result: RunResult, sourcePath: string) => {
          shown.push(result)
          sourcePaths.push(sourcePath)
        },
      } as unknown as Awaited<ReturnType<() => Promise<never>>>),
    openVarianceView: () => Promise.resolve({
      showProgress: (progress: unknown) => progressShown.push(progress),
      showGroup: (group: VarianceGroup) => groupsShown.push(group),
      showFailure: (message: string) => notices.push(message),
    } as never),
    notify: message => notices.push(message),
    markOffline: () => {},
    holdReached: (runId, nodeId) => Promise.resolve(void held.push(`${runId} ${nodeId}`)),
  })
}

/** Opens the picker, then answers each modal in turn the way a reader would. */
async function run(...picks: number[]): Promise<void> {
  const runner = makeRunner()
  await runner.start()
  for (const pick of picks) {
    const modal = lastModal()
    if (!modal) throw new Error('no modal open')
    modal.choose(pick)
    await Promise.resolve()
  }
  await vi.waitFor(() => expect(launched.length + varianceRequests.length + notices.length).toBeGreaterThan(0))
}

beforeEach(() => {
  resetModals()
  launched = []
  varianceCapability = undefined
  varianceRequests = []
  varianceEvents = []
  varianceGroup = {
    groupId: 'group-1',
    chainName: 'Telephone Relay',
    seedPrompt: 'the whole note',
    expectedRunCount: 2,
    completedRunCount: 2,
    costUsd: 0,
    runs: [],
    nodes: [],
  }
  progressShown = []
  groupsShown = []
  events = []
  held = []
  shown = []
  sourcePaths = []
  notices = []
  store = new MemoryNoteStore({ 'premise.md': '---\ntags: [x]\n---\nthe whole note' })
  store.inFront = { path: 'premise.md', selection: '' }
})

describe('what the run reads', () => {
  it('runs the whole note, minus its frontmatter, when nothing is selected', async () => {
    await run(0, 0)
    expect(launched[0].seedPrompt).toBe('the whole note')
    expect(shown[0].seed).toEqual({ note: 'premise.md', from: 'note' })
  })

  it('runs the selection when there is one, and the header says the run covered less', async () => {
    store.inFront = { path: 'premise.md', selection: 'one paragraph' }
    await run(0, 0)
    expect(launched[0].seedPrompt).toBe('one paragraph')
    expect(shown[0].seed).toEqual({ note: 'premise.md', from: 'selection' })
  })

  it('opens the picker for an empty note and launches creative-director without a hint', async () => {
    store.notes['premise.md'] = '---\ntags: [x]\n---\n'

    await run(2, 0)

    expect(launched).toEqual([{ chainName: 'creative-director', seedPrompt: '', paramValue: '3 - fresh' }])
    expect(shown[0]?.seed).toEqual({ note: 'premise.md', from: 'none' })
    expect(sourcePaths).toEqual(['premise.md'])
    expect(notices).toEqual([])
  })

  it('offers the note as a rough hint or no hint for creative-director', async () => {
    await run(2, 0, 0)

    expect(launched[0]).toMatchObject({ chainName: 'creative-director', seedPrompt: 'the whole note', paramValue: '3 - fresh' })
    expect(shown[0]?.seed).toEqual({ note: 'premise.md', from: 'note' })
  })

  it('can start creative-director without using a nonempty note as a hint', async () => {
    await run(2, 0, 1)

    expect(launched[0]).toMatchObject({ chainName: 'creative-director', seedPrompt: '', paramValue: '3 - fresh' })
    expect(shown[0]?.seed).toEqual({ note: 'premise.md', from: 'none' })
    expect(sourcePaths).toEqual(['premise.md'])
  })

  it('offers the current selection as the rough hint', async () => {
    store.inFront = { path: 'premise.md', selection: 'one paragraph' }

    await run(2, 0, 0)

    expect(launched[0]).toMatchObject({ chainName: 'creative-director', seedPrompt: 'one paragraph' })
    expect(shown[0]?.seed).toEqual({ note: 'premise.md', from: 'selection' })
  })

  it('names both seed choices in the picker', async () => {
    const runner = makeRunner()
    await runner.start()
    lastModal()?.choose(2)
    await Promise.resolve()
    lastModal()?.choose(0)
    await Promise.resolve()

    const picker = lastModal() as unknown as {
      placeholder: string
      getItems(): SeedChoice[]
      getItemText(choice: SeedChoice): string
    }
    expect(picker.placeholder).toBe('Choose how to start')
    expect(picker.getItems()).toEqual(['hint', 'no-hint'])
    expect(picker.getItems().map(choice => picker.getItemText(choice))).toEqual([
      'Use the note as a rough hint',
      'Start with no hint',
    ])
  })
})

describe('the dropdown a chain declares', () => {
  it('launches on the pick when the chain declares none', async () => {
    await run(0, 0)
    expect(launched[0]).toMatchObject({ chainName: 'Telephone Relay' })
    expect(launched[0].paramValue).toBeUndefined()
  })

  it('asks once, in a second suggester, before the run starts', async () => {
    const runner = makeRunner()
    await runner.start()
    lastModal()?.choose(1)
    await Promise.resolve()
    expect(launched).toEqual([])
    expect(lastModal()?.placeholder).toBe('Choose lens')
  })

  it('sends the value with the run, so the chain reads the parameter it declared', async () => {
    await run(1, 0, 0)
    expect(launched[0]).toMatchObject({ chainName: 'Through A Lens', paramValue: 'sceptic' })
  })

  it('shows the name and the value in the header', async () => {
    await run(1, 1, 0)
    expect(shown[0].parameter).toEqual({ name: 'lens', value: 'builder' })
  })
})

describe('variance runs', () => {
  it.each([false, undefined])('keeps the single-run launch when varianceGroups is %s', async capability => {
    varianceCapability = capability

    await run(0, 0)

    expect(launched).toHaveLength(1)
    expect(varianceRequests).toEqual([])
  })

  it('offers a single run or 2–10 runs when the engine supports variance groups', async () => {
    varianceCapability = true
    const runner = makeRunner()
    await runner.start()
    lastModal()?.choose(0)
    await Promise.resolve()
    lastModal()?.choose(0)
    await Promise.resolve()

    const picker = lastModal() as unknown as { getItems(): number[]; getItemText(count: number): string }
    expect(picker.getItems()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(picker.getItemText(1)).toBe('Run once')
    expect(picker.getItemText(5)).toBe('Run 5 times')
  })

  it('keeps the single-run choice on the ordinary run endpoint', async () => {
    varianceCapability = true

    await run(0, 0, 0)

    expect(launched).toHaveLength(1)
    expect(varianceRequests).toEqual([])
  })

  it('sends the chosen count, keeps interleaved members separate, and opens the engine-named group', async () => {
    varianceCapability = true
    varianceEvents = [
      { type: 'run_start', runId: 'r0', instance: 0 },
      { type: 'run_start', runId: 'r1', instance: 1 },
      { type: 'agent_start', agentName: 'Draft A', nodeId: 'writer', step: 0, instance: 0 },
      { type: 'token', nodeId: 'writer', token: 'A', instance: 0 },
      { type: 'agent_start', agentName: 'Draft B', nodeId: 'writer', step: 0, instance: 1 },
      { type: 'token', nodeId: 'writer', token: 'B', instance: 1 },
      { type: 'variance_complete', groupId: 'group-1', runIds: ['r0', 'r1'] },
    ]

    await run(0, 0, 1)
    await vi.waitFor(() => expect(groupsShown).toEqual([varianceGroup]))

    expect(launched).toEqual([])
    expect(varianceRequests).toEqual([{ chainName: 'Telephone Relay', seedPrompt: 'the whole note', count: 2 }])
    expect(progressShown.at(-1)).toMatchObject({
      members: [
        { instance: 0, runId: 'r0', currentNode: 'Draft A' },
        { instance: 1, runId: 'r1', currentNode: 'Draft B' },
      ],
    })
  })
})

describe('a run that reaches a hold', () => {
  it('hands on each hold, once the view shows the run', async () => {
    const hold = { nodeId: 'pick', input: '', candidates: [], reachedAt: 'now' }
    events = [
      { type: 'run_start', runId: 'r1' },
      { type: 'run_waiting', runId: 'r1', nodeId: 'pick', hold },
      { type: 'run_waiting', runId: 'r1', nodeId: 'pick-2', hold: { ...hold, nodeId: 'pick-2' } },
    ]
    await run(0, 0)
    await vi.waitFor(() => expect(held).toEqual(['r1 pick', 'r1 pick-2']))
    expect(shown.at(-1)?.runId).toBe('r1')
  })

  it('hands on nothing for a run that completed', async () => {
    events = [{ type: 'run_start', runId: 'r1' }, { type: 'run_complete', runId: 'r1' }]
    await run(0, 0)
    await vi.waitFor(() => expect(shown.at(-1)?.status).toBe('done'))
    expect(held).toEqual([])
  })
})
