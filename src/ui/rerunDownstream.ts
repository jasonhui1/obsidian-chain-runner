import { normalizePath, type App } from 'obsidian'
import { readIfPresent } from './vaultWrite'
import { fetchRun, rerunAndRefresh } from './rerunAndRefresh'
import { CANON_PATH } from '../run/canon'
import { holdHeading, proposalEdits } from '../run/holdNote'
import { rerunRequest } from '../run/rerun'
import type { EngineClient } from '../engine/client'

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

    const source = await this.deps.withEngine(() => fetchRun(engine, heading.runId))
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

    await rerunAndRefresh(this.deps, file, heading, request)
  }
}
