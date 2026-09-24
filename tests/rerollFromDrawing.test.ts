import { describe, expect, it } from 'vitest'
import { RerollFromDrawing, REROLL_ALREADY_ANSWERED } from '@/ui/rerollFromDrawing'
import { ContinueFromDrawing } from '@/ui/continueFromDrawing'
import { stampHold } from '@/ui/holdColumn'
import type { Holds } from '@/ui/holds'

const RUN = 'run-1'
const view = { file: null }
const stamp = { runId: RUN, nodeId: 'pick', heading: '', revision: 2, role: 'reroll' as const }
const element = { customData: stampHold(stamp) }
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('Reroll on a drawing', () => {
  it('rerolls an open hold on double-click with no feedback and refreshes the column on success', async () => {
    const actions: string[] = []
    let release = (): void => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    let now = 100

    const rerollFromDrawing = new RerollFromDrawing({
      surface: { unavailable: () => undefined, selectedRun: () => undefined, cardProposal: () => undefined },
      holds: {
        read: async () => ({
          holds: [{ nodeId: 'pick', revision: 2, candidates: [{ heading: 'Old', body: 'Old text', ticked: false }] }],
        }) as unknown as Awaited<ReturnType<Holds['read']>>,
        reroll: async (runId, holdId, feedback) => {
          actions.push(`reroll ${runId} ${holdId} feedback:${String(feedback)}`)
          await gate
          return {
            holds: [{ nodeId: 'pick', revision: 3, candidates: [{ heading: 'New', body: 'New text', ticked: false }] }],
          } as unknown as Awaited<ReturnType<Holds['reroll']>>
        },
      },
      notify: message => void actions.push(`notify:${message}`),
      now: () => now,
      refreshColumn: async (runId, nodeId) => { actions.push(`refreshed ${runId} ${nodeId}`) },
    })

    rerollFromDrawing.handleSelection(element, view)
    expect(actions).toEqual([])
    rerollFromDrawing.handleDoubleClick()
    rerollFromDrawing.handleTextEdit(element, view)
    await settle()
    expect(actions).toEqual(['reroll run-1 pick feedback:undefined'])

    now = 200
    rerollFromDrawing.handleDoubleClick()
    await settle()
    expect(actions.filter(a => a.startsWith('reroll'))).toHaveLength(1)

    release()
    await settle()
    expect(actions).toEqual(['reroll run-1 pick feedback:undefined', 'refreshed run-1 pick'])
  })

  it('keeps old cards and does not refresh when reroll returns no candidates or retains revision', async () => {
    const actions: string[] = []
    const notify = (message: string): void => { actions.push(`notify:${message}`) }
    const rerollFromDrawing = new RerollFromDrawing({
      surface: { unavailable: () => undefined, selectedRun: () => undefined, cardProposal: () => undefined },
      holds: {
        read: async () => ({
          holds: [{ nodeId: 'pick', revision: 2, candidates: [{ heading: 'Old', body: 'Old text', ticked: false }] }],
        }) as unknown as Awaited<ReturnType<Holds['read']>>,
        reroll: async () => {
          notify('Reroll failed: Reroll returned no candidates; the previous candidates stay — the run is still waiting')
          return {
            holds: [{ nodeId: 'pick', revision: 2, candidates: [{ heading: 'Old', body: 'Old text', ticked: false }] }],
          } as unknown as Awaited<ReturnType<Holds['reroll']>>
        },
      },
      notify,
      now: () => 100,
      refreshColumn: async () => { actions.push('refreshed') },
    })

    rerollFromDrawing.handleSelection(element, view)
    rerollFromDrawing.handleDoubleClick()
    await settle()
    expect(actions).toEqual(['notify:Reroll failed: Reroll returned no candidates; the previous candidates stay — the run is still waiting'])
  })

  it('does not reroll when the hold is already answered', async () => {
    const actions: string[] = []
    const rerollFromDrawing = new RerollFromDrawing({
      surface: { unavailable: () => undefined, selectedRun: () => undefined, cardProposal: () => undefined },
      holds: {
        read: async () => ({ holds: [] }) as unknown as Awaited<ReturnType<Holds['read']>>,
        reroll: async () => { actions.push('rerolled'); return undefined },
      },
      notify: message => void actions.push(message),
      now: () => 100,
      refreshColumn: async () => {},
    })

    rerollFromDrawing.handleSelection(element, view)
    rerollFromDrawing.handleDoubleClick()
    await settle()
    expect(actions).toEqual([REROLL_ALREADY_ANSWERED])
  })

  it('ensures a candidate card from before the reroll cannot answer with a stale revision', async () => {
    const actions: string[] = []
    let currentRevision = 2

    const holds = {
      read: async () => ({
        holds: [{ nodeId: 'pick', revision: currentRevision, candidates: [{ heading: 'Idea', body: 'Text', ticked: false }] }],
      }) as unknown as Awaited<ReturnType<Holds['read']>>,
      reroll: async () => {
        currentRevision = 3
        return {
          holds: [{ nodeId: 'pick', revision: 3, candidates: [{ heading: 'Idea 2', body: 'Text 2', ticked: false }] }],
        } as unknown as Awaited<ReturnType<Holds['reroll']>>
      },
      pickCandidate: async () => { actions.push('ticked'); return undefined },
      resume: async (_runId: string, pick?: { revision?: number }) => {
        actions.push(`resume attempted with revision ${pick?.revision}`)
        if (pick?.revision !== currentRevision) return undefined
        return { forked: false } as unknown as Awaited<ReturnType<Holds['resume']>>
      },
    }

    const rerollFromDrawing = new RerollFromDrawing({
      surface: { unavailable: () => undefined, selectedRun: () => undefined, cardProposal: () => undefined },
      holds,
      notify: () => {},
      now: () => 100,
      refreshColumn: async () => { actions.push('column refreshed') },
    })

    const continueFromDrawing = new ContinueFromDrawing({
      surface: { unavailable: () => undefined, selectedRun: () => undefined, cardProposal: () => undefined },
      holds,
      notify: () => {},
      now: () => 100,
      refreshColumn: async () => { actions.push('column refreshed after stale pick') },
    })

    rerollFromDrawing.handleSelection(element, view)
    rerollFromDrawing.handleDoubleClick()
    await settle()
    expect(actions).toEqual(['column refreshed'])

    const oldCandidateStamp = { runId: RUN, nodeId: 'pick', heading: 'Idea', revision: 2, role: 'continue' as const }
    continueFromDrawing.handleSelection({ customData: stampHold(oldCandidateStamp) }, view)
    continueFromDrawing.handleDoubleClick()
    await settle()

    expect(actions).toEqual([
      'column refreshed',
      'resume attempted with revision 2',
      'column refreshed after stale pick',
    ])
  })
})
