import { describe, expect, it } from 'vitest'
import { ContinueFromDrawing } from '@/ui/continueFromDrawing'
import { stampHold } from '@/ui/holdColumn'
import type { Holds } from '@/ui/holds'

const RUN = 'run-1'
const view = { file: null }
const stamp = { runId: RUN, nodeId: 'pick', heading: 'Candidate 1', revision: 2, role: 'continue' as const }
const element = { customData: stampHold(stamp) }
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

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
        resume: async (_runId, pick) => { calls.push(pick!.heading); await gate; return undefined },
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
})
