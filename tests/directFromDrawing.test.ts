import { describe, it, expect, beforeEach } from 'vitest'
import { DirectFromDrawing, SELECT_A_RUN } from '@/ui/directFromDrawing'
import { buildDirectLabel } from '@/ui/runLabel'
import type { Point } from '@/ui/panelSpot'

/** Directing a run from the drawing: the label's two clicks, and the palette command on a selection. */

const RUN = '2026-09-15-ubqPU2'
const label = buildDirectLabel({ x: 0, y: 0, width: 1000, height: 400 }, RUN)

let directed: string[]
let notices: string[]
let selected: string | undefined
let unavailable: string | undefined
let settleWith: Point | undefined

function make(): DirectFromDrawing {
  return new DirectFromDrawing({
    surface: {
      unavailable: () => unavailable,
      selectedRun: () => selected,
    },
    direct: runId => {
      directed.push(runId)
      return Promise.resolve()
    },
    notify: message => void notices.push(message),
    clickSpot: settled => settled(settleWith),
  })
}

beforeEach(() => {
  directed = []
  notices = []
  selected = undefined
  unavailable = undefined
  settleWith = { x: 10, y: 10 }
})

describe('handleLinkClick', () => {
  it('directs the label’s run, and stops the link opening', () => {
    expect(make().handleLinkClick(label)).toBe(false)
    expect(directed).toEqual([RUN])
  })

  it('passes on a link that is not a Direct label', () => {
    expect(make().handleLinkClick({ customData: { chainRunner: {} } })).toBe(true)
    expect(directed).toEqual([])
  })
})

describe('handleSelection', () => {
  it('directs the label’s run on a plain click', () => {
    make().handleSelection(label)
    expect(directed).toEqual([RUN])
  })

  it('does nothing when the press was a drag, not a click', () => {
    settleWith = undefined
    make().handleSelection(label)
    expect(directed).toEqual([])
  })

  it('ignores every other element', () => {
    make().handleSelection({})
    expect(directed).toEqual([])
  })
})

describe('directSelected', () => {
  it('directs the run the selection belongs to', async () => {
    selected = RUN
    await make().directSelected()
    expect(directed).toEqual([RUN])
  })

  it('asks for a run’s card when the selection names none', async () => {
    await make().directSelected()
    expect(notices).toEqual([SELECT_A_RUN])
    expect(directed).toEqual([])
  })

  it('says why when there is no drawing surface', async () => {
    unavailable = 'Excalidraw is not installed'
    selected = RUN
    await make().directSelected()
    expect(notices).toEqual(['Excalidraw is not installed'])
    expect(directed).toEqual([])
  })

  it('says so rather than throwing when the drawing cannot be read', async () => {
    const command = new DirectFromDrawing({
      surface: {
        unavailable: () => undefined,
        selectedRun: () => {
          throw new Error('Open the Excalidraw drawing as its own tab to do that.')
        },
      },
      direct: () => Promise.resolve(),
      notify: message => void notices.push(message),
      clickSpot: () => {},
    })
    await command.directSelected()
    expect(notices).toEqual(['Open the Excalidraw drawing as its own tab to do that.'])
  })
})
