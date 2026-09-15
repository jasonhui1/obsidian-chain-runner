import { normalizePath, type App, type TFile } from 'obsidian'
import { readIfPresent } from './vaultWrite'
import { fetchRun, rerunAndRefresh } from './rerunAndRefresh'
import { CANON_PATH } from '../run/canon'
import { holdHeading, proposalEdits } from '../run/holdNote'
import { rerunRequest } from '../run/rerun'
import type { EngineClient } from '../engine/client'
import { engineFailureMessage } from '../engine/guard'
import type { LayoutPanel } from '../engine/types'

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
  /** A finished run's panels never change, so each is fetched once. */
  private readonly panelsByRun = new Map<string, LayoutPanel[]>()

  constructor(private readonly deps: RerunDownstreamDeps) {}

  async start(): Promise<void> {
    const file = this.deps.app.workspace.getActiveFile()
    if (file?.extension === 'md') await this.rerun(file, await this.deps.app.vault.cachedRead(file))
    else this.deps.notify(NOT_A_HOLD_NOTE)
  }

  /** Reruns downstream of the edited proposals in `content`, the hold note's as read; answers the run the note now lives under. */
  async rerun(file: TFile, content: string): Promise<string | undefined> {
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
      proposalsStale: current => !sameEdits(proposalEdits(current, panels), edits),
    })
  }

  /** What the run wrote, panel by panel; `undefined`, without a notice, while the engine cannot say. */
  async panels(runId: string): Promise<LayoutPanel[] | undefined> {
    const known = this.panelsByRun.get(runId)
    if (known) return known
    try {
      const { panels } = await this.deps.engine.getLayout(runId)
      this.panelsByRun.set(runId, panels)
      return panels
    } catch (error) {
      if (engineFailureMessage(error) === undefined) throw error
      return undefined
    }
  }
}

function sameEdits(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every(key => a[key] === b[key])
}
