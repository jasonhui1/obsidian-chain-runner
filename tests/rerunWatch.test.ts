import { describe, it, expect } from 'vitest'
import { RerunWatch, type RerunLanding } from '@/run/rerunWatch'
import type { LayoutPanel } from '@/engine/types'
import type { RerunProgress } from '@/run/rerunProgress'

/** Every rerun, heard by whoever listens, whether or not the panel started it. */

const OLD = '2026-09-15-old'
const OLDER = '2026-09-14-older'
const NEW = '2026-09-16-new'

const writing: RerunProgress = { verdict: true, proposals: ['world'], cards: ['world', 'verdict'] }
const panels: LayoutPanel[] = [{ name: 'verdict', node: 'v', text: 'New.', lines: 1, state: 'filled', emphasis: 'join' }]

describe('RerunWatch', () => {
  it('says nothing is rewritten before a rerun has named its cards', () => {
    const watch = new RerunWatch()
    watch.begin([OLD])
    expect(watch.rewriting(OLD, 'verdict')).toBeUndefined()
  })

  it('names the cards a rerun writes again, under every run its hold has been', () => {
    const watch = new RerunWatch()
    watch.begin([OLD, OLDER]).hear(writing)
    expect(watch.rewriting(OLD, 'verdict')).toEqual(writing)
    expect(watch.rewriting(OLDER, 'world')).toEqual(writing)
    expect(watch.rewriting(OLD, 'gameplay')).toBeUndefined()
    expect(watch.rewriting(NEW, 'verdict')).toBeUndefined()
  })

  it('tells its listeners of each change, until they stop listening', () => {
    const watch = new RerunWatch()
    let heard = 0
    const stop = watch.onChange(() => heard++)
    const rerun = watch.begin([OLD])
    rerun.hear(writing)
    rerun.end()
    stop()
    watch.begin([OLD]).hear(writing)
    expect(heard).toBe(2)
  })

  it('forgets the cards once the rerun ends, however it ended', () => {
    const watch = new RerunWatch()
    const rerun = watch.begin([OLD])
    rerun.hear(writing)
    rerun.end()
    expect(watch.rewriting(OLD, 'verdict')).toBeUndefined()
  })

  it('leaves a later rerun of the same run alone when an earlier one ends', () => {
    const watch = new RerunWatch()
    const first = watch.begin([OLD])
    const second = watch.begin([OLD])
    second.hear(writing)
    first.end()
    expect(watch.rewriting(OLD, 'verdict')).toEqual(writing)
  })

  it('hands a landing to every lander, with the runs it came from, before the cards are forgotten', async () => {
    const watch = new RerunWatch()
    const landed: RerunLanding[] = []
    let stillRewriting: RerunProgress | undefined
    watch.onLanding(async landing => {
      stillRewriting = watch.rewriting(OLD, 'verdict')
      landed.push(landing)
    })
    const rerun = watch.begin([OLD, OLDER])
    rerun.hear(writing)
    await rerun.land({ runId: NEW, chainName: 'creative-director', panels })
    expect(landed).toEqual([{ from: [OLD, OLDER], runId: NEW, chainName: 'creative-director', panels }])
    expect(stillRewriting).toEqual(writing)
  })

  it('stops handing landings to a lander that has stopped', async () => {
    const watch = new RerunWatch()
    let landed = 0
    watch.onLanding(async () => void landed++)()
    await watch.begin([OLD]).land({ runId: NEW, chainName: 'c', panels })
    expect(landed).toBe(0)
  })
})
