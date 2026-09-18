import { describe, it, expect, beforeEach } from 'vitest'
import { RerunOnDrawing } from '@/ui/rerunOnDrawing'
import type { DrawingView, RerunSurface } from '@/ui/excalidraw'
import type { RerunLanding } from '@/run/rerunWatch'
import type { RunProvenance } from '@/ui/outputNotes'
import type { RunPanel } from '@/run/panels'
import type { LayoutPanel } from '@/engine/types'

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

function makeFollower(): RerunOnDrawing {
  /** Each open drawing's view, known here by its name. */
  const names = new Map<DrawingView, string>(Object.keys(drawings).map(name => [{ file: null }, name]))
  const surface: RerunSurface = {
    unavailable: () => unavailable,
    openViews: () => [...names.keys()],
    on: view => {
      const name = names.get(view as DrawingView) as string
      bound.push(name)
      return {
        followRerun: async (from, to, noteFor) => {
          const shown = drawings[name]
          if (shown === 'unreachable') throw new Error('That drawing went away')
          if (!shown) return false
          const notes: Record<string, string | undefined> = {}
          for (const output of shown) notes[output] = await noteFor(output)
          followed.push({ view: name, from, to, notes })
          return true
        },
      }
    },
  }
  return new RerunOnDrawing({
    surface,
    notes: {
      write: async (panel, run) => {
        written.push({ panel, run })
        if (refused.includes(panel.name)) return undefined
        return `runs/${run.runId}/${panel.name}.md`
      },
    },
    notify: message => void notices.push(message),
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
})

describe('RerunOnDrawing', () => {
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
