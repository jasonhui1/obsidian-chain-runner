import type { RepliedTurn } from './chat'
import type { RerunProgress } from './rerunProgress'
import type { LayoutPanel } from '../engine/types'

/**
 * Every rerun going, from its start to its end: the one registry the drawing's
 * cards, the header and the directing panel all read. Told by the rerun itself,
 * so no panel has to be open.
 */

/** What started a rerun: the edited proposals, a reply used as the revision, or a resume. */
export type RerunCause = { kind: 'edits' } | { kind: 'reply'; turn: RepliedTurn } | { kind: 'resume' }

/** A rerun going: what started it, when, and how it is getting on once it has said. */
export interface GoingRerun {
  readonly cause: RerunCause
  readonly startedAt: number
  readonly progress?: RerunProgress
}

/** A rerun that landed: the runs its hold was under, and the run it moved to. */
export interface RerunLanding {
  from: readonly string[]
  runId: string
  chainName: string
  panels: LayoutPanel[]
}

/** What a rerun tells the watch as it goes. `end` comes last, whether it landed or not. */
export interface RerunReport {
  hear(progress: RerunProgress): void
  /** Waits for every lander. */
  land(landed: Omit<RerunLanding, 'from'>): Promise<void>
  end(): void
}

/** Follows a landed rerun; must not throw, since the hold has already moved. */
export type RerunLander = (landing: RerunLanding) => Promise<void>

export class RerunWatch {
  private readonly reruns = new Map<string, GoingRerun>()
  private readonly listeners = new Set<() => void>()
  private readonly landers = new Set<RerunLander>()

  constructor(private readonly now: () => number = Date.now) {}

  /** A rerun of the hold under `from`: the run it branches from, then the runs that hold was under before. */
  begin(from: readonly string[], cause: RerunCause): RerunReport {
    let rerun: GoingRerun = { cause, startedAt: this.now() }
    let ended = false
    const record = (): void => {
      for (const runId of from) this.reruns.set(runId, rerun)
      this.changed()
    }
    record()
    return {
      hear: progress => {
        if (ended) return
        rerun = { ...rerun, progress }
        record()
      },
      land: async landed => {
        for (const lander of [...this.landers]) await lander({ from, ...landed })
      },
      end: () => {
        ended = true
        for (const runId of from) if (this.reruns.get(runId) === rerun) this.reruns.delete(runId)
        this.changed()
      },
    }
  }

  /** The rerun going under run `runId`, if one is. */
  going(runId: string): GoingRerun | undefined {
    return this.reruns.get(runId)
  }

  /** The rerun writing run `runId`'s card `card` again, if one is. */
  rewriting(runId: string, card: string): RerunProgress | undefined {
    const progress = this.reruns.get(runId)?.progress
    return progress?.cards.includes(card) ? progress : undefined
  }

  /** Calls `listener` whenever any rerun moves on or ends; returns what stops it. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Hands every landed rerun to `lander`; returns what stops it. */
  onLanding(lander: RerunLander): () => void {
    this.landers.add(lander)
    return () => this.landers.delete(lander)
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
