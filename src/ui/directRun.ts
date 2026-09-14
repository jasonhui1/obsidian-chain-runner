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
}

export class DirectRun {
  constructor(private readonly deps: DirectRunDeps) {}

  async start(): Promise<void> {
    const result = this.deps.currentRun()
    if (!result?.runId || result.status === 'running') {
      this.deps.notify(NO_RUN_TO_DIRECT)
      return
    }
    const { runId, chainName } = result

    const fetched = await this.deps.withEngine(async () => {
      const [layout, run] = await Promise.all([this.deps.engine.getLayout(runId), this.deps.engine.getRun(runId)])
      return { layout, run }
    })
    if (!fetched) return

    const file = await this.deps.holdNotes.write({
      runId,
      chainName,
      panels: fetched.layout.panels,
      thoughts: thoughtsByNode(fetched.run.agentOutputs),
    })
    if (file) this.deps.notify(`Wrote the hold note for run ${runId}`)
  }
}
