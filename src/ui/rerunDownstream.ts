import { normalizePath, type App, type TFile } from 'obsidian'
import { readIfPresent } from './vaultWrite'
import { fetchRun, rerunAndRefresh } from './rerunAndRefresh'
import { CANON_PATH } from '../run/canon'
import { holdHeading, proposalEdits } from '../run/holdNote'
import { rerunRequest } from '../run/rerun'
import type { OnRerunProgress } from '../run/rerunProgress'
import type { EngineClient } from '../engine/client'
import type { RerunWatch } from '../run/rerunWatch'

/** The "Rerun downstream" command: the vault half of `src/run/rerun.ts`. */

export const NOT_A_HOLD_NOTE = 'Open a hold note to rerun downstream of it'
export const NO_EDITED_PROPOSAL = 'Edit a proposal in this hold note first'

export interface RerunDownstreamDeps {
  app: App
  engine: EngineClient
  withEngine: <T>(action: () => Promise<T>) => Promise<T | undefined>
  notify: (message: string) => void
  reruns: RerunWatch
}

export class RerunDownstream {
  constructor(private readonly deps: RerunDownstreamDeps) {}

  async start(): Promise<void> {
    const file = this.deps.app.workspace.getActiveFile()
    if (file?.extension === 'md') await this.rerun(file, await this.deps.app.vault.cachedRead(file))
    else this.deps.notify(NOT_A_HOLD_NOTE)
  }

  /** Reruns downstream of the edited proposals in `content`, the hold note's as read; answers the run the note now lives under. */
  async rerun(file: TFile, content: string, onProgress?: OnRerunProgress): Promise<string | undefined> {
    const { app, engine, notify } = this.deps
    const heading = holdHeading(content)
    if (!heading) {
      notify(NOT_A_HOLD_NOTE)
      return undefined
    }
    const source = await this.deps.withEngine(() => fetchRun(engine, heading.runId))
    if (!source) return undefined
    const panels = source.layout.panels

    const edits = proposalEdits(content, panels)
    if (Object.keys(edits).length === 0) {
      notify(NO_EDITED_PROPOSAL)
      return undefined
    }
    const canon = await readIfPresent(app, normalizePath(CANON_PATH))
    const request = rerunRequest(source.run, panels, edits, canon)
    if (!request) {
      notify(`Run ${heading.runId} carries no graph to rerun from`)
      return undefined
    }

    return rerunAndRefresh(this.deps, file, heading, request, {
      edits: { before: panels, sent: edits },
      onProgress,
    })
  }
}
