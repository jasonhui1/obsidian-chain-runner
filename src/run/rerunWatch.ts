import type { RerunProgress } from './rerunProgress'
import type { LayoutPanel } from '../engine/types'

/**
 * Every rerun going, for whatever follows one without having started it — the
 * drawing's cards. Told by the rerun itself, so no panel has to be open.
 */

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

/** One rerun, as the watch holds it; `progress` is unset until its first frame. */
interface WatchedRerun {
  progress?: RerunProgress
}

export class RerunWatch {
  private readonly going = new Map<string, WatchedRerun>()
  private readonly listeners = new Set<() => void>()
  private readonly landers = new Set<RerunLander>()

  /** A rerun of the hold under `from`: the run it branches from, then the runs that hold was under before. */
  begin(from: readonly string[]): RerunReport {
    const rerun: WatchedRerun = {}
    for (const runId of from) this.going.set(runId, rerun)
    return {
      hear: progress => {
        rerun.progress = progress
        this.changed()
      },
      land: async landed => {
        for (const lander of [...this.landers]) await lander({ from, ...landed })
      },
      end: () => {
        for (const runId of from) if (this.going.get(runId) === rerun) this.going.delete(runId)
        this.changed()
      },
    }
  }

  /** The rerun writing run `runId`'s card `card` again, if one is. */
  rewriting(runId: string, card: string): RerunProgress | undefined {
    const progress = this.going.get(runId)?.progress
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
