import { describe, it, expect, beforeEach } from 'vitest'
import { RerunOnDrawing, type RerunOnDrawingDeps } from '@/ui/rerunOnDrawing'
import type { DrawingView, RerunDrawing, RerunSurface } from '@/ui/excalidraw'
import type { RerunLanding } from '@/run/rerunWatch'
import type { RunProvenance } from '@/ui/outputNotes'
import type { RunPanel } from '@/run/panels'
import type { LayoutPanel, RunMeta } from '@/engine/types'
import { started } from './engineFrames'

/** A landed rerun, followed on every drawing open: which notes are filed, and what each drawing is asked to do. */

const OLD = '2026-09-15-old'
const NEW = '2026-09-16-new'

const panel = (name: string, text: string): LayoutPanel => ({ name, node: name, text, lines: 1, state: 'filled' })

const landing: RerunLanding = {
  from: [OLD],
  runId: NEW,
  chainName: 'creative-director',
  panels: [panel('World', 'Replayed.'), panel('Verdict', 'Burden-driven combat.')],
}

let unavailable: string | undefined
/** The outputs each open drawing shows cards for; a missing entry shows none. */
let drawings: Record<string, string[] | 'unreachable'>
let written: { panel: RunPanel; run: RunProvenance }[]
let followed: { view: string; from: readonly string[]; to: string; notes: Record<string, string | undefined> }[]
let notices: string[]
let refused: string[]
/** Each drawing bound, by name, in the order it was. */
let bound: string[]
let titles: (string | undefined)[]

function makeFollower(engine?: RerunOnDrawingDeps['engine']): RerunOnDrawing {
  /** Each open drawing's view, known here by its name. */
  const names = new Map<DrawingView, string>(Object.keys(drawings).map(name => [{ file: null }, name]))
  const surface: RerunSurface = {
    unavailable: () => unavailable,
    openViews: () => [...names.keys()],
    on: view => {
      const name = names.get(view as DrawingView) as string
      bound.push(name)
      return {
        pickSources: () => [],
        placePickRow: async () => true,
        updatePickCounts: async () => true,
        refreshHoldColumn: async () => true, placeRowHold: async () => false,
        followRerun: async (from, to, noteFor, title) => {
          const shown = drawings[name]
          if (shown === 'unreachable') throw new Error('That drawing went away')
          if (!shown) return false
          const notes: Record<string, string | undefined> = {}
          for (const output of shown) notes[output] = await noteFor(output)
          followed.push({ view: name, from, to, notes })
          titles.push(title)
          return true
        },
      }
    },
  }
  return new RerunOnDrawing({
    surface,
    notes: {
      open: async (panel, run) => ({ path: `runs/${run.runId}/${panel.name}.md`, write: async () => {} }),
      write: async (panel, run) => {
        written.push({ panel, run })
        if (refused.includes(panel.name)) return undefined
        return `runs/${run.runId}/${panel.name}.md`
      },
    },
    notify: message => void notices.push(message),
    engine,
  })
}

beforeEach(() => {
  unavailable = undefined
  drawings = {}
  written = []
  followed = []
  notices = []
  refused = []
  bound = []
  titles = []
})

describe('RerunOnDrawing', () => {
  it('uses the recorded run name when moving an existing frame', async () => {
    drawings['A'] = ['World']
    const run = {
      runId: NEW, chainName: 'creative-director', seedPrompt: '', startedAt: '2026-09-16T00:41:00',
      status: 'complete' as const, agentOutputs: [],
    }
    await makeFollower({
      getRun: async () => run,
      listForks: async () => [],
      getLayout: async () => ({ kind: 'timeline', panels: [] }),
    }).land(landing)
    expect(titles).toEqual(['creative-director · 00:41'])
  })

  it('files an in-place pick output even when its drawing is closed', async () => {
    await makeFollower().land({ ...landing, from: [NEW], pick: { nodeId: 'pick', heading: 'Candidate 1', pending: [0] } })
    expect(written.map(one => one.panel.name)).toEqual(['World'])
    expect(followed).toEqual([])
  })
  it('opens a first pick row at run_start and fills its normal note as tokens arrive', async () => {
    const pending: LayoutPanel = { name: 'World', node: 'world', text: '', lines: 0, state: 'pending' }
    const placed: string[] = []
    const filled: string[] = []
    const counts: number[] = []
    const picked = new RerunOnDrawing({
      surface: {
        unavailable: () => undefined,
        openViews: () => [{ file: null }],
        on: () => ({
          pickSources: () => [],
          placePickRow: async (_landing, outputs) => { placed.push(...outputs.map(one => one.notePath)); return true },
          updatePickCounts: async landing => { counts.push(landing.panels[0]?.lines ?? -1); return true },
          refreshHoldColumn: async () => true, placeRowHold: async () => false,
          followRerun: async () => false,
        }),
      },
      notes: {
        open: async () => ({ path: `runs/${OLD}/World.md`, write: async panel => { filled.push(panel.text) } }),
        write: async () => { throw new Error('a streamed note must be reused') },
      },
      notify: message => void notices.push(message),
    })
    const stream = { sourceRunId: OLD, runId: OLD, chainName: 'creative-director', pick: { nodeId: 'pick', heading: 'Candidate 1', pending: [0] }, sourcePanels: [pending] }
    await picked.streamPick({ ...stream, event: started(OLD)[0]! })
    await picked.streamPick({ ...stream, event: { type: 'token', nodeId: 'world', token: 'First line\nSecond' } })
    expect(placed).toEqual([`runs/${OLD}/World.md`])
    expect(filled).toContain('First line\nSecond')
    expect(counts).toContain(2)
    await picked.land({ from: [OLD], runId: OLD, chainName: 'creative-director', panels: [{ ...pending, text: 'First line\nSecond line', lines: 2, state: 'filled' }], pick: stream.pick })
    expect(filled.at(-1)).toBe('First line\nSecond line')
    expect(notices).toEqual([])
  })

  it('streams a fork into its own row and keeps the earlier pick', async () => {
    const rows: string[] = []
    const writes: string[] = []
    const pending: LayoutPanel = { name: 'World', node: 'world', text: '', lines: 0, state: 'pending' }
    const picked = new RerunOnDrawing({
      surface: {
        unavailable: () => undefined, openViews: () => [{ file: null }],
        on: () => ({
          pickSources: () => [],
          placePickRow: async (one, outputs) => {
            const row = `${one.runId}:${one.pick?.heading}:${outputs[0]?.notePath}`
            if (!rows.includes(row)) rows.push(row)
            return true
          },
          updatePickCounts: async () => true, refreshHoldColumn: async () => true, placeRowHold: async () => false, followRerun: async () => false,
        }),
      },
      notes: {
        open: async (_panel, run) => ({ path: `runs/${run.runId}/World.md`, write: async panel => { writes.push(panel.text) } }),
        write: async () => { throw new Error('fork stream must reuse its note') },
      },
      notify: message => void notices.push(message),
    })
    const pick = { nodeId: 'pick', heading: 'Candidate 2', pending: [0] }
    const stream = { sourceRunId: OLD, runId: NEW, chainName: 'creative-director', pick, sourcePanels: [pending] }
    await picked.streamPick({ ...stream, event: started(NEW)[0]! })
    await picked.streamPick({ ...stream, event: { type: 'token', nodeId: 'world', token: 'New route' } })
    await picked.land({ from: [OLD], runId: NEW, chainName: 'creative-director', panels: [{ ...pending, state: 'filled', text: 'New route', lines: 1 }], pick })
    expect(rows).toEqual([`${NEW}:Candidate 2:runs/${NEW}/World.md`])
    expect(writes).toContain('New route')
    expect(notices).toEqual([])
  })

  it('keeps interleaved candidates in separate rows and output notes', async () => {
    const rows: string[] = []
    const writes: string[] = []
    const view: DrawingView = { file: null }
    const pending: LayoutPanel = { name: 'World', node: 'world', text: '', lines: 0, state: 'pending' }
    const picked = new RerunOnDrawing({
      surface: {
        unavailable: () => undefined, openViews: () => [view],
        on: () => ({
          pickSources: () => [],
          placePickRow: async one => { if (!rows.includes(one.runId)) rows.push(one.runId); return true },
          updatePickCounts: async () => true, refreshHoldColumn: async () => true, placeRowHold: async () => false, followRerun: async () => false,
        }),
      },
      notes: {
        open: async (_panel, run) => ({ path: `runs/${run.runId}/World.md`, write: async panel => { writes.push(`${run.runId}:${panel.text}`) } }),
        write: async () => { throw new Error('streamed notes must be reused') },
      },
      notify: message => void notices.push(message),
    })
    for (const [runId, heading] of [[NEW, 'Candidate 1'], ['other-fork', 'Candidate 2']]) {
      await picked.streamPick({ sourceRunId: OLD, runId, chainName: 'creative-director',
        pick: { nodeId: 'pick', heading, pending: [0] }, sourcePanels: [pending], event: started(runId)[0]! })
    }
    for (const [runId, heading, token] of [[NEW, 'Candidate 1', 'Alpha\nnext'], ['other-fork', 'Candidate 2', 'Beta\nnext']]) {
      await picked.streamPick({ sourceRunId: OLD, runId, chainName: 'creative-director',
        pick: { nodeId: 'pick', heading, pending: [0] }, sourcePanels: [pending], event: { type: 'token', nodeId: 'world', token } })
    }
    expect(rows).toEqual([NEW, 'other-fork'])
    expect(writes).toContain(`${NEW}:Alpha\nnext`)
    expect(writes).toContain('other-fork:Beta\nnext')
    expect(writes).not.toContain(`${NEW}:Beta\nnext`)
    expect(notices).toEqual([])
  })

  it('serializes writes to one open drawing while two picks start', async () => {
    let active = 0
    let mostActive = 0
    const view: DrawingView = { file: null }
    const picked = new RerunOnDrawing({
      surface: {
        unavailable: () => undefined, openViews: () => [view],
        on: () => ({
          pickSources: () => [],
          placePickRow: async () => {
            active++
            mostActive = Math.max(mostActive, active)
            await new Promise(resolve => setTimeout(resolve, 0))
            active--
            return true
          },
          updatePickCounts: async () => true, refreshHoldColumn: async () => true, placeRowHold: async () => false, followRerun: async () => false,
        }),
      },
      notes: {
        open: async (_panel, run) => ({ path: `runs/${run.runId}/World.md`, write: async () => {} }),
        write: async () => undefined,
      },
      notify: message => void notices.push(message),
    })
    const start = (runId: string, heading: string) => picked.streamPick({
      sourceRunId: OLD, runId, chainName: 'creative-director',
      pick: { nodeId: 'pick', heading, pending: [0] },
      sourcePanels: [{ name: 'World', node: 'world', text: '', lines: 0, state: 'pending' }],
      event: started(runId)[0]!,
    })
    await Promise.all([start(NEW, 'Candidate 1'), start('other-fork', 'Candidate 2')])
    expect(mostActive).toBe(1)
    expect(notices).toEqual([])
  })

  it('rebuilds an outside fork from engine records when a drawing is reopened', async () => {
    const rows: string[] = []
    const paths: string[] = []
    const sourceHold = { nodeId: 'pick', input: '', reachedAt: 'now', candidates: [], chosen: 'Candidate 1' }
    const origin = { runId: OLD, chainName: 'creative-director', seedPrompt: '', startedAt: 'now', agentOutputs: [], status: 'complete' as const, holds: [sourceHold] }
    const fork = { runId: NEW, chainName: 'creative-director', seedPrompt: '', startedAt: 'now', agentOutputs: [], status: 'complete' as const,
      branchedFromRunId: OLD, branchedFromNode: 'pick', holds: [{ ...sourceHold, chosen: 'Candidate 2' }] }
    const view: DrawingView = { file: null }
    const picked = new RerunOnDrawing({
      surface: {
        unavailable: () => undefined, openViews: () => [view],
        on: () => ({
          pickSources: () => [{ runId: OLD, nodeId: 'pick', outputIndexes: [1], placed: [OLD] }],
          placePickRow: async (one, outputs) => { rows.push(`${one.from[0]}:${one.runId}:${one.pick?.heading}`); paths.push(...outputs.map(output => output.notePath)); return true },
          updatePickCounts: async () => true, refreshHoldColumn: async () => true, placeRowHold: async () => false, followRerun: async () => false,
        }),
      },
      notes: {
        open: async () => undefined,
        write: async (one, run) => `runs/${run.runId}/${one.name}.md`,
      },
      engine: {
        getRun: async () => origin,
        listForks: async () => [fork],
        getLayout: async () => ({ kind: 'undeclared', panels: [panel('Before', 'old'), panel('World', 'new')] }),
      },
      notify: message => void notices.push(message),
    })
    await picked.rebuild(view)
    expect(rows).toEqual([`${OLD}:${NEW}:Candidate 2`])
    expect(paths).toEqual([`runs/${NEW}/World.md`])
    expect(notices).toEqual([])
  })
  describe('a picked run that stops at another hold', () => {
    const secondHold = { nodeId: 'hold-2', input: '', reachedAt: 'later', candidates: [{ heading: 'idea a', body: 'A world.' }] }
    const graph = { nodes: [], edges: [
      { fromNode: 'pick', toNode: 'world' }, { fromNode: 'world', toNode: 'hold-2' }, { fromNode: 'hold-2', toNode: 'verdict' },
    ] }
    const panels = [panel('Before', 'old'), panel('World', 'new'), { ...panel('Verdict', ''), node: 'verdict', state: 'pending' as const }]
    const pick = { nodeId: 'pick', heading: 'Candidate 2', pending: [1, 2] }
    const waiting = {
      runId: NEW, chainName: 'creative-director', seedPrompt: '', startedAt: 'now', agentOutputs: [], status: 'waiting' as const,
      branchedFromRunId: OLD, branchedFromNode: 'pick', graph,
      holds: [{ nodeId: 'pick', input: '', reachedAt: 'now', candidates: [], chosen: 'Candidate 2', resolvedAt: 'now' }, secondHold],
    } as unknown as RunMeta

    function drawn(run: RunMeta, sources: ReturnType<RerunDrawing['pickSources']> = []): { calls: string[]; follower: RerunOnDrawing } {
      const calls: string[] = []
      const follower = new RerunOnDrawing({
        surface: {
          unavailable: () => undefined, openViews: () => [{ file: null }],
          on: () => ({
            pickSources: () => sources,
            placePickRow: async one => { calls.push(`row ${one.runId}`); return true },
            placeRowHold: async (one, held) => { calls.push(`hold ${one.runId} ${held.holds.map(({ hold, pending }) => `${hold.nodeId} [${pending.join(',')}]`).join(' ')} drops [${held.unreached.join(',')}]`); return true },
            updatePickCounts: async () => true, refreshHoldColumn: async () => true, followRerun: async () => false,
          }),
        },
        notes: { open: async () => undefined, write: async (one, meta) => `runs/${meta.runId}/${one.name}.md` },
        engine: {
          getRun: async runId => (runId === NEW ? run : { ...run, runId: OLD, holds: [{ nodeId: 'pick', input: '', reachedAt: 'now', candidates: [] }] }),
          listForks: async () => [run],
          getLayout: async () => ({ kind: 'undeclared', panels }),
        },
        notify: message => void notices.push(message),
      })
      return { calls, follower }
    }

    it('draws that hold at the end of its row, without the cards it has not reached', async () => {
      const { calls, follower } = drawn(waiting)
      await follower.land({ from: [OLD], runId: NEW, chainName: 'creative-director', panels, pick })
      expect(calls).toEqual([`row ${NEW}`, `hold ${NEW} hold-2 [2] drops [2]`])
      expect(notices).toEqual([])
    })

    it('draws no hold for a run that finished', async () => {
      const { calls, follower } = drawn({ ...waiting, status: 'complete' })
      await follower.land({ from: [OLD], runId: NEW, chainName: 'creative-director', panels, pick })
      expect(calls).toEqual([`row ${NEW}`])
    })

    it('draws only the hold when a drawing reopens on a row it already shows', async () => {
      const { calls, follower } = drawn(waiting, [{ runId: OLD, nodeId: 'pick', outputIndexes: [1, 2], placed: [NEW] }])
      await follower.rebuild({ file: null })
      expect(calls).toEqual([`hold ${NEW} hold-2 [2] drops [2]`])
    })

    it('draws it again when a drawing reopens on a row made while it was closed', async () => {
      const { calls, follower } = drawn(waiting, [{ runId: OLD, nodeId: 'pick', outputIndexes: [1, 2], placed: [] }])
      await follower.rebuild({ file: null })
      expect(calls).toEqual([`row ${NEW}`, `hold ${NEW} hold-2 [2] drops [2]`])
      expect(notices).toEqual([])
    })
  })

  it('points each card on an open drawing at its output’s note, filed under the new run', async () => {
    drawings = { board: ['Verdict', 'World'] }
    await makeFollower().land(landing)
    expect(followed).toEqual([
      { view: 'board', from: [OLD], to: NEW, notes: { Verdict: `runs/${NEW}/Verdict.md`, World: `runs/${NEW}/World.md` } },
    ])
    expect(written.map(one => one.run)).toEqual([
      { runId: NEW, chainName: 'creative-director' },
      { runId: NEW, chainName: 'creative-director' },
    ])
    expect(written[0]?.panel.text).toBe('Burden-driven combat.')
  })

  it('follows on every open drawing, filing only the outputs a drawing shows', async () => {
    drawings = { board: ['Verdict'], sketch: [] }
    await makeFollower().land(landing)
    expect(followed.map(one => one.view)).toEqual(['board', 'sketch'])
    expect(bound).toEqual(['board', 'sketch'])
    expect(written.map(one => one.panel.name)).toEqual(['Verdict'])
  })

  it('leaves a card whose output the new run no longer has as it is', async () => {
    drawings = { board: ['Gone'] }
    await makeFollower().land(landing)
    expect(followed[0]?.notes).toEqual({ Gone: undefined })
    expect(written).toEqual([])
  })

  it('leaves a card whose note the vault refused as it is', async () => {
    refused = ['Verdict']
    drawings = { board: ['Verdict'] }
    await makeFollower().land(landing)
    expect(followed[0]?.notes).toEqual({ Verdict: undefined })
  })

  it('says so when a drawing cannot be reached, and still follows the rest', async () => {
    drawings = { gone: 'unreachable', board: ['Verdict'] }
    await makeFollower().land(landing)
    expect(notices).toEqual(['That drawing went away'])
    expect(followed.map(one => one.view)).toEqual(['board'])
  })

  it('touches nothing without Excalidraw', async () => {
    unavailable = 'no Excalidraw'
    drawings = { board: ['Verdict'] }
    await makeFollower().land(landing)
    expect(followed).toEqual([])
    expect(notices).toEqual([])
  })
})
