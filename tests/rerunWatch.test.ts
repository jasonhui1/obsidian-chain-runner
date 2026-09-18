import { describe, it, expect } from 'vitest'
import { RerunWatch, type RerunCause, type RerunLanding } from '@/run/rerunWatch'
import type { LayoutPanel } from '@/engine/types'
import type { RerunProgress } from '@/run/rerunProgress'

/** Every rerun, heard by whoever listens, whether or not the panel started it. */

const OLD = '2026-09-15-old'
const OLDER = '2026-09-14-older'
const NEW = '2026-09-16-new'

const writing: RerunProgress = { verdict: true, proposals: ['world'], cards: ['world', 'verdict'] }
const EDITS: RerunCause = { kind: 'edits' }
const panels: LayoutPanel[] = [{ name: 'verdict', node: 'v', text: 'New.', lines: 1, state: 'filled', emphasis: 'join' }]

describe('RerunWatch', () => {
  it('says nothing is rewritten before a rerun has named its cards', () => {
    const watch = new RerunWatch()
    watch.begin([OLD], EDITS)
    expect(watch.rewriting(OLD, 'verdict')).toBeUndefined()
  })

  it('names the cards a rerun writes again, under every run its hold has been', () => {
    const watch = new RerunWatch()
    watch.begin([OLD, OLDER], EDITS)!.hear(writing)
    expect(watch.rewriting(OLD, 'verdict')).toEqual(writing)
    expect(watch.rewriting(OLDER, 'world')).toEqual(writing)
    expect(watch.rewriting(OLD, 'gameplay')).toBeUndefined()
    expect(watch.rewriting(NEW, 'verdict')).toBeUndefined()
  })

  it('holds a rerun from its start, under every run its hold has been: what started it, when, and how it is getting on', () => {
    let now = 5000
    const watch = new RerunWatch(() => now)
    const reply: RerunCause = { kind: 'reply', turn: { name: 'world', message: 'who watches?', reply: 'The player.', turn: 2 } }
    const rerun = watch.begin([OLD, OLDER], reply)!
    now = 9000
    expect(watch.going(OLD)).toEqual({ cause: reply, startedAt: 5000 })
    rerun.hear(writing)
    expect(watch.going(OLDER)).toEqual({ cause: reply, startedAt: 5000, progress: writing })
    expect(watch.going(NEW)).toBeUndefined()
  })

  it('lets go of a rerun once it ends', () => {
    const watch = new RerunWatch()
    watch.begin([OLD, OLDER], { kind: 'resume' })!.end()
    expect(watch.going(OLD)).toBeUndefined()
    expect(watch.going(OLDER)).toBeUndefined()
  })

  it('takes no word from a rerun that has ended', () => {
    const watch = new RerunWatch()
    const rerun = watch.begin([OLD], EDITS)!
    rerun.end()
    rerun.hear(writing)
    expect(watch.going(OLD)).toBeUndefined()
  })

  it('tells its listeners of each change, its start included, until they stop listening', () => {
    const watch = new RerunWatch()
    let heard = 0
    const stop = watch.onChange(() => heard++)
    const rerun = watch.begin([OLD], EDITS)!
    rerun.hear(writing)
    rerun.end()
    stop()
    watch.begin([OLD], EDITS)!.hear(writing)
    expect(heard).toBe(3)
  })

  it('forgets the cards once the rerun ends, however it ended', () => {
    const watch = new RerunWatch()
    const rerun = watch.begin([OLD], EDITS)!
    rerun.hear(writing)
    rerun.end()
    expect(watch.rewriting(OLD, 'verdict')).toBeUndefined()
  })

  it('starts no second rerun under a run one is going under, until it ends', () => {
    const watch = new RerunWatch()
    const first = watch.begin([OLD, OLDER], EDITS)!
    expect(watch.begin([OLDER], { kind: 'resume' })).toBeUndefined()
    expect(watch.going(OLDER)?.cause).toEqual(EDITS)
    first.end()
    expect(watch.begin([OLDER], { kind: 'resume' })).toBeDefined()
  })

  it('widens a rerun to the runs its hold turns out to have been under, told to its listeners', () => {
    const watch = new RerunWatch()
    let heard = 0
    watch.onChange(() => heard++)
    const rerun = watch.begin([OLD], EDITS)!
    expect(rerun.widen([OLD, OLDER])).toBe(true)
    expect(watch.going(OLDER)?.cause).toEqual(EDITS)
    expect(heard).toBe(2)
    rerun.end()
    expect(watch.going(OLDER)).toBeUndefined()
  })

  it('widens a rerun onto no run another rerun is going under', () => {
    const watch = new RerunWatch()
    watch.begin([OLDER], { kind: 'resume' })
    const rerun = watch.begin([OLD], EDITS)!
    expect(rerun.widen([OLD, OLDER])).toBe(false)
    expect(watch.going(OLDER)?.cause).toEqual({ kind: 'resume' })
    rerun.end()
    expect(watch.going(OLDER)?.cause).toEqual({ kind: 'resume' })
  })

  it('tells the time its reruns start by', () => {
    const watch = new RerunWatch(() => 1234)
    expect(watch.now()).toBe(1234)
  })

  it('hands a landing to every lander, with the runs it came from, before the cards are forgotten', async () => {
    const watch = new RerunWatch()
    const landed: RerunLanding[] = []
    let stillRewriting: RerunProgress | undefined
    watch.onLanding(async landing => {
      stillRewriting = watch.rewriting(OLD, 'verdict')
      landed.push(landing)
    })
    const rerun = watch.begin([OLD], EDITS)!
    rerun.widen([OLD, OLDER])
    rerun.hear(writing)
    await rerun.land({ runId: NEW, chainName: 'creative-director', panels })
    expect(landed).toEqual([{ from: [OLD, OLDER], runId: NEW, chainName: 'creative-director', panels }])
    expect(stillRewriting).toEqual(writing)
  })

  it('stops handing landings to a lander that has stopped', async () => {
    const watch = new RerunWatch()
    let landed = 0
    watch.onLanding(async () => void landed++)()
    await watch.begin([OLD], EDITS)!.land({ runId: NEW, chainName: 'c', panels })
    expect(landed).toBe(0)
  })
})
