import type { TFile } from 'obsidian'
import type { HoldNotes } from './holdNotes'
import type { EngineClient } from '../engine/client'
import { thoughtsByNode } from '../run/holdNote'
import type { RunResult } from '../run/session'

/**
 * The "Direct this run" command: a finished run's layout, turned into a hold
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
  open: (note: TFile, runId: string) => Promise<void>
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
    const file = await this.write(runId, chainName)
    if (file) await this.deps.open(file, runId)
  }

  /** Writes the hold note for a run, without opening it. */
  async write(runId: string, chainName?: string): Promise<TFile | undefined> {
    const fetched = await this.deps.withEngine(async () => {
      const [layout, run] = await Promise.all([this.deps.engine.getLayout(runId), this.deps.engine.getRun(runId)])
      return { layout, run }
    })
    if (!fetched) return undefined

    const file = await this.deps.holdNotes.write({
      runId,
      chainName: chainName ?? fetched.run.chainName,
      panels: fetched.layout.panels,
      thoughts: thoughtsByNode(fetched.run.agentOutputs),
    })
    if (file) this.deps.notify(`Wrote the hold note for run ${runId}`)
    return file
  }

  /** Opens the run's hold, writing it first only when there is none. */
  async openHold(runId: string): Promise<void> {
    const current = await this.deps.holdNotes.currentRun(runId)
    const held = this.deps.holdNotes.find(current)
    if (held) await this.deps.open(held, current)
    else await this.direct(runId)
  }
}
