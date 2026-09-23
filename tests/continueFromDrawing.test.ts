import { describe, expect, it } from 'vitest'
import { ContinueFromDrawing, DOUBLE_TO_CONTINUE, PICK_ALREADY_ANSWERED } from '@/ui/continueFromDrawing'
import { stampHold } from '@/ui/holdColumn'
import type { Holds } from '@/ui/holds'

const RUN = 'run-1'
const view = { file: null }
const stamp = { runId: RUN, nodeId: 'pick', heading: 'Candidate 1', revision: 2, role: 'continue' as const }
const element = { customData: stampHold(stamp) }
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('Continue on a drawing', () => {
  it('explains one click and resumes exactly once for two reports of the same double-click', async () => {
    const actions: string[] = []
    let release = (): void => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    let now = 100
    const continueFromDrawing = new ContinueFromDrawing({
      surface: { unavailable: () => undefined, selectedRun: () => undefined, cardProposal: () => undefined },
      holds: {
        pickCandidate: async () => {
          actions.push('pick')
          return { holds: [{ nodeId: 'pick', chosen: 'Candidate 1' }] } as Awaited<ReturnType<Holds['pickCandidate']>>
        },
        resume: async (_runId, pick) => {
          actions.push(`resume ${pick?.revision}`)
          await gate
          return undefined
        },
        read: async () => ({ holds: [{ nodeId: 'pick', revision: 2 }] }) as Awaited<ReturnType<Holds['read']>>,
      },
      notify: message => void actions.push(message),
      clickSpot: callback => callback({ x: 1, y: 2 }),
      now: () => now,
      refreshColumn: async () => {},
    })
    continueFromDrawing.handleSelection(element, view)
    expect(actions).toEqual([DOUBLE_TO_CONTINUE])
    continueFromDrawing.handleDoubleClick()
    continueFromDrawing.handleTextEdit(element, view)
    await settle()
    expect(actions).toEqual([DOUBLE_TO_CONTINUE, 'pick', 'resume 2'])
    now = 200
    continueFromDrawing.handleDoubleClick()
    await settle()
    expect(actions.filter(action => action === 'pick')).toHaveLength(1)
    release()
    await settle()
  })

  it('leaves a rerolled hold note untouched and asks the engine about the card’s old revision', async () => {
    const actions: string[] = []
    const continueFromDrawing = new ContinueFromDrawing({
      surface: { unavailable: () => undefined, selectedRun: () => undefined, cardProposal: () => undefined },
      holds: {
        read: async () => ({ holds: [{ nodeId: 'pick', revision: 3 }] }) as Awaited<ReturnType<Holds['read']>>,
        pickCandidate: async () => { actions.push('ticked'); return undefined },
        resume: async (_runId, pick) => { actions.push(`engine ${pick?.revision}`); return undefined },
      },
      notify: message => void actions.push(message),
      clickSpot: () => {},
      now: () => 100,
      refreshColumn: async () => { actions.push('refreshed') },
    })
    continueFromDrawing.handleSelection(element, view)
    continueFromDrawing.handleDoubleClick()
    await settle()
    expect(actions).toEqual(['engine 2', 'refreshed'])
  })

  it('does not replace the first row with a second pick before fork rows exist', async () => {
    const actions: string[] = []
    const continueFromDrawing = new ContinueFromDrawing({
      surface: { unavailable: () => undefined, selectedRun: () => undefined, cardProposal: () => undefined },
      holds: {
        read: async () => ({ holds: [] }) as unknown as Awaited<ReturnType<Holds['read']>>,
        pickCandidate: async () => { actions.push('ticked'); return undefined },
        resume: async () => { actions.push('resumed'); return undefined },
      },
      notify: message => void actions.push(message), clickSpot: () => {}, now: () => 100,
      refreshColumn: async () => {},
    })
    continueFromDrawing.handleSelection(element, view)
    continueFromDrawing.handleDoubleClick()
    await settle()
    expect(actions).toEqual([PICK_ALREADY_ANSWERED])
  })
})
