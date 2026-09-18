import type { HoldNotes } from './holdNotes'
import { fetchRun, type FetchedRun } from './rerunAndRefresh'
import type { EngineClient } from '../engine/client'
import { engineFailureMessage } from '../engine/guard'
import { waitingHolds } from '../engine/types'
import { holdNoteInput } from '../run/holdNote'
import type { RunResult } from '../run/session'

/**
 * The "Direct this run" command: a finished or waiting run turned into a hold
 * note. What the note holds is `src/run/holdNote.ts`; the vault write is
 * `src/ui/holdNotes.ts`. This is only the fetch that feeds them.
 */

export const NO_RUN_TO_DIRECT = 'No finished run to direct'

export interface DirectRunDeps {
  engine: EngineClient
  withEngine: <T>(action: () => Promise<T>) => Promise<T | undefined>
  notify: (message: string) => void
  holdNotes: HoldNotes
  /** The run on screen, if any — this command has no run of its own to pick from. */
  currentRun: () => RunResult | undefined
  /** Shows the hold once it is written. */
  open: (path: string, runId: string) => Promise<void>
}

export class DirectRun {
  constructor(private readonly deps: DirectRunDeps) {}

  async start(): Promise<void> {
    const result = this.deps.currentRun()
    if (!result?.runId || result.status === 'running') {
      this.deps.notify(NO_RUN_TO_DIRECT)
      return
    }
    await this.direct(result.runId, result.chainName)
  }

  /** Writes and opens the hold note for a run; without a chain name, the one the engine recorded. */
  async direct(runId: string, chainName?: string): Promise<void> {
    const path = await this.write(runId, chainName)
    if (path) await this.deps.open(path, runId)
  }

  /** Writes the hold note for a run, without opening it. */
  async write(runId: string, chainName?: string): Promise<string | undefined> {
    const path = await this.fetchAndWrite(runId, chainName)
    if (path) this.deps.notify(`Wrote the hold note for run ${runId}`)
    return path
  }

  /** A run being watched reached a hold; its note shows every hold reached so far. */
  async holdReached(runId: string, nodeId: string): Promise<void> {
    if (await this.fetchAndWrite(runId)) this.deps.notify(`Run ${runId} is waiting at ${nodeId}: its hold note is written`)
  }

  /** Opens the run's hold, brought up to date, or written first when there is none. */
  async openHold(runId: string): Promise<void> {
    const current = await this.deps.holdNotes.currentRun(runId)
    const held = this.deps.holdNotes.find(current)
    if (!held) return this.direct(runId)
    await this.refresh(current)
    await this.deps.open(held, current)
  }

  /**
   * Rewrites the run's hold note when it shows other holds than the run waits at.
   * Quietly: a note the engine cannot be asked about stays as it is.
   */
  async refresh(runId: string): Promise<void> {
    const current = await this.deps.holdNotes.currentRun(runId)
    if (!this.deps.holdNotes.find(current)) return
    try {
      const waiting = await this.deps.engine.waitingRun(current)
      const open = waitingHolds(waiting?.holds).map(hold => hold.nodeId)
      const shown = await this.deps.holdNotes.holdsShown(current)
      if (open.join('\n') === shown.join('\n')) return
      await this.writeFetched(await fetchRun(this.deps.engine, current))
    } catch (error) {
      if (engineFailureMessage(error) === undefined) throw error
    }
  }

  private async fetchAndWrite(runId: string, chainName?: string): Promise<string | undefined> {
    const fetched = await this.deps.withEngine(() => fetchRun(this.deps.engine, runId))
    return fetched && this.writeFetched(fetched, chainName)
  }

  private writeFetched({ run, layout }: FetchedRun, chainName?: string): Promise<string | undefined> {
    return this.deps.holdNotes.write(holdNoteInput(run, layout.panels, chainName))
  }
}
