import { describe, expect, it } from 'vitest'
import { ContinueFromDrawing, TYPE_FIRST } from '@/ui/continueFromDrawing'
import { stampHold } from '@/ui/holdColumn'
import type { Holds } from '@/ui/holds'
import type { SelectionSurface } from '@/ui/excalidraw'

const RUN = 'run-1'
const view = { file: null }
const stamp = { runId: RUN, nodeId: 'pick', heading: 'Candidate 1', revision: 2, role: 'continue' as const }
const element = { customData: stampHold(stamp) }
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))
const ownWordsContinue = { customData: stampHold({ runId: RUN, nodeId: 'pick', heading: '', revision: 2, role: 'continue', custom: true }) }
const ownWordsSurface = (ownWords: () => string): SelectionSurface => ({
  unavailable: () => undefined,
  selectedRun: () => undefined,
  cardProposal: () => undefined,
  on: () => ({ selectedContinue: () => undefined, selectedReroll: () => undefined, ownWords }),
})

describe('Continue on a drawing', () => {
  it('keeps one click quiet and resumes exactly once for two reports of the same double-click', async () => {
    const actions: string[] = []
    let release = (): void => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    let now = 100
    const continueFromDrawing = new ContinueFromDrawing({
      surface: { unavailable: () => undefined, selectedRun: () => undefined, cardProposal: () => undefined },
      holds: {
        resume: async (_runId, pick) => {
          actions.push(`resume ${pick?.revision}`)
          await gate
          return undefined
        },
        read: async () => ({ holds: [{ nodeId: 'pick', revision: 2 }] }) as Awaited<ReturnType<Holds['read']>>,
      },
      notify: message => void actions.push(message),
      now: () => now,
      refreshColumn: async () => {},
    })
    continueFromDrawing.handleSelection(element, view)
    expect(actions).toEqual([])
    continueFromDrawing.handleDoubleClick()
    continueFromDrawing.handleTextEdit(element, view)
    await settle()
    expect(actions).toEqual(['resume 2'])
    now = 200
    continueFromDrawing.handleDoubleClick()
    await settle()
    expect(actions.filter(action => action === 'resume 2')).toHaveLength(1)
    release()
    await settle()
  })

  it('leaves a rerolled hold note untouched and asks the engine about the card’s old revision', async () => {
    const actions: string[] = []
    const continueFromDrawing = new ContinueFromDrawing({
      surface: { unavailable: () => undefined, selectedRun: () => undefined, cardProposal: () => undefined },
      holds: {
        read: async () => ({ holds: [{ nodeId: 'pick', revision: 3 }] }) as Awaited<ReturnType<Holds['read']>>,
        resume: async (_runId, pick) => { actions.push(`engine ${pick?.revision}`); return undefined },
      },
      notify: message => void actions.push(message),
      now: () => 100,
      refreshColumn: async () => { actions.push('refreshed') },
    })
    continueFromDrawing.handleSelection(element, view)
    continueFromDrawing.handleDoubleClick()
    await settle()
    expect(actions).toEqual(['engine 2', 'refreshed'])
  })

  it('resumes an answered hold again to let the engine fork a second pick', async () => {
    const actions: string[] = []
    const continueFromDrawing = new ContinueFromDrawing({
      surface: { unavailable: () => undefined, selectedRun: () => undefined, cardProposal: () => undefined },
      holds: {
        read: async () => ({ holds: [] }) as unknown as Awaited<ReturnType<Holds['read']>>,
        resume: async () => { actions.push('resumed'); return undefined },
      },
      notify: message => void actions.push(message), now: () => 100,
      refreshColumn: async () => {},
    })
    continueFromDrawing.handleSelection(element, view)
    continueFromDrawing.handleDoubleClick()
    await settle()
    expect(actions).toEqual(['resumed'])
  })

  it('starts different candidates before either continuation finishes', async () => {
    const calls: string[] = []
    let release = (): void => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    let now = 100
    const continueFromDrawing = new ContinueFromDrawing({
      surface: { unavailable: () => undefined, selectedRun: () => undefined, cardProposal: () => undefined },
      holds: {
        read: async () => ({ holds: [] }) as unknown as Awaited<ReturnType<Holds['read']>>,
        resume: async (_runId, pick) => { calls.push(pick?.heading ?? ''); await gate; return undefined },
      },
      notify: message => void calls.push(message), now: () => now,
      refreshColumn: async () => {},
    })
    for (const heading of ['Candidate 1', 'Candidate 2', 'Candidate 3']) {
      const candidate = { customData: stampHold({ ...stamp, heading }) }
      continueFromDrawing.handleSelection(candidate, view)
      continueFromDrawing.handleDoubleClick()
      now += 100
    }
    await settle()
    expect(calls).toEqual(['Candidate 1', 'Candidate 2', 'Candidate 3'])
    release()
    await settle()
  })

  it('asks once to type something first when the own-words card is empty', async () => {
    const actions: string[] = []
    let now = 100
    const continueFromDrawing = new ContinueFromDrawing({
      surface: ownWordsSurface(() => ''),
      holds: {
        read: async () => ({ holds: [] }) as unknown as Awaited<ReturnType<Holds['read']>>,
        resume: async () => { actions.push('resumed'); return undefined },
      },
      notify: message => void actions.push(message),
      now: () => now,
      refreshColumn: async () => {},
    })

    continueFromDrawing.handleSelection(ownWordsContinue, view)
    continueFromDrawing.handleDoubleClick()
    continueFromDrawing.handleTextEdit(ownWordsContinue, view)
    await settle()
    expect(actions).toEqual([TYPE_FIRST])

    now += 1500
    continueFromDrawing.handleSelection(ownWordsContinue, view)
    continueFromDrawing.handleDoubleClick()
    await settle()
    expect(actions).toEqual([TYPE_FIRST, TYPE_FIRST])
  })

  it('sends the words on the card when Continue is clicked, as custom', async () => {
    const resumed: unknown[] = []
    let typed = 'A first draft.'
    const continueFromDrawing = new ContinueFromDrawing({
      surface: ownWordsSurface(() => typed),
      holds: {
        read: async () => ({ holds: [] }) as unknown as Awaited<ReturnType<Holds['read']>>,
        resume: async (_runId, pick) => { resumed.push(pick); return undefined },
      },
      notify: () => {},
      now: () => 100,
      refreshColumn: async () => {},
    })

    typed = 'A theme park.\nWith rollercoasters.'
    continueFromDrawing.handleSelection(ownWordsContinue, view)
    continueFromDrawing.handleDoubleClick()
    await settle()
    expect(resumed).toEqual([{ nodeId: 'pick', custom: 'A theme park.\nWith rollercoasters.', revision: 2 }])
  })

  it('starts a second idea of the reader’s own while the first is still going, but the same idea once', async () => {
    const calls: string[] = []
    let release = (): void => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    let now = 100
    let typed = 'A theme park.'
    const continueFromDrawing = new ContinueFromDrawing({
      surface: ownWordsSurface(() => typed),
      holds: {
        read: async () => ({ holds: [] }) as unknown as Awaited<ReturnType<Holds['read']>>,
        resume: async (_runId, pick) => { calls.push(pick?.custom ?? ''); await gate; return undefined },
      },
      notify: message => void calls.push(message),
      now: () => now,
      refreshColumn: async () => {},
    })
    for (const words of ['A theme park.', 'A theme park.', 'A floating city.']) {
      typed = words
      continueFromDrawing.handleSelection(ownWordsContinue, view)
      continueFromDrawing.handleDoubleClick()
      now += 1500
    }
    await settle()
    expect(calls).toEqual(['A theme park.', 'A floating city.'])
    release()
    await settle()
  })

  it('says why when the drawing cannot be read', async () => {
    const actions: string[] = []
    const continueFromDrawing = new ContinueFromDrawing({
      surface: ownWordsSurface(() => { throw new Error('The drawing closed') }),
      holds: {
        read: async () => ({ holds: [] }) as unknown as Awaited<ReturnType<Holds['read']>>,
        resume: async () => { actions.push('resumed'); return undefined },
      },
      notify: message => void actions.push(message),
      now: () => 100,
      refreshColumn: async () => {},
    })
    continueFromDrawing.handleSelection(ownWordsContinue, view)
    continueFromDrawing.handleDoubleClick()
    await settle()
    expect(actions).toEqual(['The drawing closed'])
  })

  it('does not resume when editing the own-words card’s text', async () => {
    const actions: string[] = []
    const customCardElement = { customData: stampHold({ runId: RUN, nodeId: 'pick', heading: '', role: 'custom' as const }) }
    const continueFromDrawing = new ContinueFromDrawing({
      surface: { unavailable: () => undefined, selectedRun: () => undefined, cardProposal: () => undefined },
      holds: {
        read: async () => ({ holds: [] }) as unknown as Awaited<ReturnType<Holds['read']>>,
        resume: async () => { actions.push('resumed'); return undefined },
      },
      notify: message => void actions.push(message),
      now: () => 100,
      refreshColumn: async () => {},
    })

    continueFromDrawing.handleTextEdit(customCardElement, view)
    await settle()
    expect(actions).toEqual([])
  })
})
