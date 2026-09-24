import type { RepliedTurn } from './chat'
import type { RerunProgress } from './rerunProgress'
import type { LayoutPanel } from '../engine/types'
import type { RunEvent } from '../engine/types'

/** Every rerun in flight, shared by drawing cards, output headers and the directing panel. */

/** What started a rerun: the edited proposals, a reply used as the revision, or a resume. */
export type RerunCause = { kind: 'edits' } | { kind: 'reply'; turn: RepliedTurn } | { kind: 'resume' } | { kind: 'reroll' }

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
  /** A resume from a waiting hold fills its own candidate row on the drawing. */
  pick?: { nodeId: string; heading: string; pending: number[]; words?: string }
}

/** A drawing candidate running from a waiting source hold. */
export interface IndependentGoing {
  readonly heading: string
  readonly runId?: string
  readonly startedAt: number
  readonly progress?: RerunProgress
}

export interface PickStream {
  sourceRunId: string
  runId: string
  chainName: string
  pick: NonNullable<RerunLanding['pick']>
  sourcePanels: LayoutPanel[]
  event: RunEvent
}

/** What a rerun tells the watch as it goes. `end` comes last, whether it landed or not. */
export interface RerunReport {
  /** Holds the rerun under `runIds` too, unless another rerun is going under one of them; whether it did. */
  widen(runIds: readonly string[]): boolean
  hear(progress: RerunProgress): void
  stream(pick: PickStream): Promise<void>
  /** Waits for every lander. */
  land(landed: Omit<RerunLanding, 'from'>): Promise<void>
  end(): void
}

/** Follows a landed rerun; must not throw, since the hold has already moved. */
export type RerunLander = (landing: RerunLanding) => Promise<void>

export class RerunWatch {
  private readonly reruns = new Map<string, GoingRerun>()
  private readonly independentPicks = new Map<object, { from: readonly string[]; going: IndependentGoing }>()
  private readonly listeners = new Set<() => void>()
  private readonly landers = new Set<RerunLander>()
  private readonly streams = new Set<(pick: PickStream) => Promise<void>>()

  /** The time each rerun's start is told by. */
  constructor(readonly now: () => number = Date.now) {}

  /** Report an independent pick without reserving its source run (#76). */
  independent(from: readonly string[], heading: string): RerunReport {
    const key = {}
    let going: IndependentGoing = { heading, startedAt: this.now() }
    this.independentPicks.set(key, { from, going })
    this.changed()
    let ended = false
    const record = (): void => {
      this.independentPicks.set(key, { from, going })
      this.changed()
    }
    return {
      widen: runIds => {
        if (ended) return false
        const runId = runIds[0]
        if (runId && going.runId !== runId) {
          going = { ...going, runId }
          record()
        }
        return true
      },
      hear: progress => {
        if (ended) return
        going = { ...going, progress }
        record()
      },
      stream: async pick => {
        for (const listener of [...this.streams]) await listener(pick)
      },
      land: async landed => {
        for (const lander of [...this.landers]) await lander({ from, ...landed })
      },
      end: () => {
        if (ended) return
        ended = true
        this.independentPicks.delete(key)
        this.changed()
      },
    }
  }

  /** The independent candidates still running from a source hold. */
  independentGoing(sourceRunId: string): IndependentGoing[] {
    return [...this.independentPicks.values()]
      .filter(one => one.from.includes(sourceRunId))
      .map(one => one.going)
  }

  /**
   * A rerun of the hold under `from`: the run it branches from, then the runs that
   * hold was under before. None while another rerun is going under one of them.
   */
  begin(from: readonly string[], cause: RerunCause): RerunReport | undefined {
    if (this.anyGoing(from)) return undefined
    let runs = from
    let rerun: GoingRerun = { cause, startedAt: this.now() }
    let ended = false
    const record = (): void => {
      for (const runId of runs) this.reruns.set(runId, rerun)
      this.changed()
    }
    record()
    return {
      widen: runIds => {
        const more = runIds.filter(runId => !runs.includes(runId))
        if (ended || this.anyGoing(more)) return false
        if (more.length === 0) return true
        runs = [...runIds, ...runs.filter(runId => !runIds.includes(runId))]
        record()
        return true
      },
      hear: progress => {
        if (ended) return
        rerun = { ...rerun, progress }
        record()
      },
      stream: async pick => {
        for (const listener of [...this.streams]) await listener(pick)
      },
      land: async landed => {
        for (const lander of [...this.landers]) await lander({ from: runs, ...landed })
      },
      end: () => {
        if (ended) return
        ended = true
        for (const runId of runs) this.reruns.delete(runId)
        this.changed()
      },
    }
  }

  private anyGoing(runIds: readonly string[]): boolean {
    return runIds.some(runId => this.reruns.has(runId))
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

  onPickStream(listener: (pick: PickStream) => Promise<void>): () => void {
    this.streams.add(listener)
    return () => this.streams.delete(listener)
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
