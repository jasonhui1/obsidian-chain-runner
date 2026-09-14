import { normalizePath, type App } from 'obsidian'
import { guardWrite, readIfPresent } from './vaultWrite'
import { CANON_PATH } from '../run/canon'
import { runHeadless } from '../run/headlessRun'
import { holdHeading, proposalEdits, refreshHoldNote, thoughtsByNode } from '../run/holdNote'
import { rerunRequest } from '../run/rerun'
import type { EngineClient } from '../engine/client'
import type { LayoutModel, RunMeta } from '../engine/types'

/** The "Rerun downstream" command: the vault half of `src/run/rerun.ts`. */

export const NOT_A_HOLD_NOTE = 'Open a hold note to rerun downstream of it'
export const NO_EDITED_PROPOSAL = 'Edit a proposal in this hold note first'

export interface RerunDownstreamDeps {
  app: App
  engine: EngineClient
  withEngine: <T>(action: () => Promise<T>) => Promise<T | undefined>
  notify: (message: string) => void
}

export class RerunDownstream {
  constructor(private readonly deps: RerunDownstreamDeps) {}

  async start(): Promise<void> {
    const { app, engine, notify } = this.deps
    const file = app.workspace.getActiveFile()
    const content = file?.extension === 'md' ? await app.vault.cachedRead(file) : ''
    const heading = holdHeading(content)
    if (!file || !heading) {
      notify(NOT_A_HOLD_NOTE)
      return
    }

    const source = await this.deps.withEngine(() => this.fetchRun(heading.runId))
    if (!source) return

    const edits = proposalEdits(content, source.layout.panels)
    if (Object.keys(edits).length === 0) {
      notify(NO_EDITED_PROPOSAL)
      return
    }
    const canon = await readIfPresent(app, normalizePath(CANON_PATH))
    const request = rerunRequest(source.run, source.layout.panels, edits, canon)
    if (!request) {
      notify(`Run ${heading.runId} carries no graph to rerun from`)
      return
    }

    const outcome = await this.deps.withEngine(() => runHeadless(engine, request))
    if (!outcome) return
    const newRunId = outcome.runId
    if (!newRunId) {
      notify(outcome.error ? `Rerun failed: ${outcome.error}` : 'Rerun produced no run')
      return
    }
    if (outcome.error) {
      notify(`Rerun ${newRunId} failed: ${outcome.error}`)
      return
    }
    const landed = await this.deps.withEngine(() => this.fetchRun(newRunId))
    if (!landed) return

    const { run, layout } = landed
    const wrote = await guardWrite(notify, 'the hold note', async () => {
      // Read again: the human may have written in the note while the rerun went.
      const current = await app.vault.cachedRead(file)
      const refreshed = refreshHoldNote(current, {
        runId: run.runId,
        chainName: heading.chainName,
        panels: layout.panels,
        thoughts: thoughtsByNode(run.agentOutputs),
      })
      await app.vault.modify(file, refreshed)
      return true
    })
    if (wrote) notify(`Reran downstream as run ${run.runId}`)
  }

  private async fetchRun(runId: string): Promise<{ run: RunMeta; layout: LayoutModel }> {
    const [run, layout] = await Promise.all([this.deps.engine.getRun(runId), this.deps.engine.getLayout(runId)])
    return { run, layout }
  }
}
