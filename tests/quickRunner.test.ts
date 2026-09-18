import { describe, it, expect, beforeEach, vi } from 'vitest'
import { QuickRunner } from '@/ui/quickRun'
import type { EngineClient } from '@/engine/client'
import type { RunEvent } from '@/engine/types'
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
]

/** What the run was launched with, and every state the view was shown. */
let launched: { chainName: string; seedPrompt: string; paramValue?: string }[]
let events: RunEvent[]
let held: string[]
let shown: RunResult[]
let notices: string[]
let store: MemoryNoteStore

function makeRunner(): QuickRunner {
  const engine = {
    capabilities: () => Promise.resolve({ runLayoutFrames: true }),
    listChains: () => Promise.resolve(CHAINS),
    launchRun: async function* (request: { chainName: string; seedPrompt: string; paramValue?: string }) {
      launched.push(request)
      for (const event of events) yield event
    },
  } as unknown as EngineClient

  return new QuickRunner({
    app: {} as App,
    store,
    engine,
    withEngine: action => action(),
    openResultView: () =>
      Promise.resolve({
        show: (result: RunResult) => shown.push(result),
      } as unknown as Awaited<ReturnType<() => Promise<never>>>),
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
  await vi.waitFor(() => expect(launched.length + notices.length).toBeGreaterThan(0))
}

beforeEach(() => {
  resetModals()
  launched = []
  events = []
  held = []
  shown = []
  notices = []
  store = new MemoryNoteStore({ 'premise.md': '---\ntags: [x]\n---\nthe whole note' })
  store.inFront = { path: 'premise.md', selection: '' }
})

describe('what the run reads', () => {
  it('runs the whole note, minus its frontmatter, when nothing is selected', async () => {
    await run(0)
    expect(launched[0].seedPrompt).toBe('the whole note')
    expect(shown[0].seed).toEqual({ note: 'premise.md', from: 'note' })
  })

  it('runs the selection when there is one, and the header says the run covered less', async () => {
    store.inFront = { path: 'premise.md', selection: 'one paragraph' }
    await run(0)
    expect(launched[0].seedPrompt).toBe('one paragraph')
    expect(shown[0].seed).toEqual({ note: 'premise.md', from: 'selection' })
  })

  it('says so and runs nothing when the note is empty', async () => {
    store.notes['premise.md'] = '---\ntags: [x]\n---\n'
    await run()
    expect(notices).toEqual(['This note is empty'])
    expect(launched).toEqual([])
  })
})

describe('the dropdown a chain declares', () => {
  it('launches on the pick when the chain declares none', async () => {
    await run(0)
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
    await run(1, 0)
    expect(launched[0]).toMatchObject({ chainName: 'Through A Lens', paramValue: 'sceptic' })
  })

  it('shows the name and the value in the header', async () => {
    await run(1, 1)
    expect(shown[0].parameter).toEqual({ name: 'lens', value: 'builder' })
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
    await run(0)
    await vi.waitFor(() => expect(held).toEqual(['r1 pick', 'r1 pick-2']))
    expect(shown.at(-1)?.runId).toBe('r1')
  })

  it('hands on nothing for a run that completed', async () => {
    events = [{ type: 'run_start', runId: 'r1' }, { type: 'run_complete', runId: 'r1' }]
    await run(0)
    await vi.waitFor(() => expect(shown.at(-1)?.status).toBe('done'))
    expect(held).toEqual([])
  })
})
