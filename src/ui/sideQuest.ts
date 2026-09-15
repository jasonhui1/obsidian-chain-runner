import type { App } from 'obsidian'
import { guardWrite } from './vaultWrite'
import { fetchRun } from './rerunAndRefresh'
import { runHeadless } from '../run/headlessRun'
import { holdHeading, proposalEdits, proposerPanels } from '../run/holdNote'
import { runViewUrl } from '../run/provenance'
import { appendSideQuestResult, pendingSideQuest } from '../run/sideQuest'
import type { EngineClient } from '../engine/client'

/** The "Side quest" command: the vault half of `src/run/sideQuest.ts`. */

export const NOT_A_HOLD_NOTE = 'Open a hold note to send a proposal on a side quest'
export const NOTHING_TO_QUEST = 'Nothing new in the Conversation section to send on a side quest'
export const NOT_A_PROPOSER = (name: string): string => `@${name} is not a proposer — only a proposal can go on a side quest`

export interface SideQuestDeps {
  app: App
  engine: EngineClient
  withEngine: <T>(action: () => Promise<T>) => Promise<T | undefined>
  notify: (message: string) => void
  engineUrl: () => string
}

export class SideQuest {
  constructor(private readonly deps: SideQuestDeps) {}

  async start(): Promise<void> {
    const { app, engine, notify } = this.deps
    const file = app.workspace.getActiveFile()
    const content = file?.extension === 'md' ? await app.vault.cachedRead(file) : ''
    const heading = holdHeading(content)
    if (!file || !heading) {
      notify(NOT_A_HOLD_NOTE)
      return
    }

    const quest = pendingSideQuest(content)
    if (!quest) {
      notify(NOTHING_TO_QUEST)
      return
    }

    const source = await this.deps.withEngine(() => fetchRun(engine, heading.runId))
    if (!source) return

    const panel = proposerPanels(source.layout.panels).find(candidate => candidate.name === quest.name)
    if (!panel) {
      notify(NOT_A_PROPOSER(quest.name))
      return
    }
    const seed = proposalEdits(content, source.layout.panels)[panel.node] ?? panel.text.trim()

    const outcome = await this.deps.withEngine(() => runHeadless(engine, { chainName: quest.chainName, seedPrompt: seed }))
    if (!outcome) return
    const runId = outcome.runId
    if (!runId) {
      notify(outcome.error ? `Side quest failed: ${outcome.error}` : 'Side quest produced no run')
      return
    }
    if (outcome.error) {
      notify(`Side quest run ${runId} failed: ${outcome.error}`)
      return
    }

    const landed = await this.deps.withEngine(() => engine.getRun(runId))
    if (!landed) return
    const result = landed.agentOutputs[landed.agentOutputs.length - 1]?.output ?? ''
    const url = runViewUrl(this.deps.engineUrl(), runId)

    const wrote = await guardWrite(notify, 'the hold note', async () => {
      // Read again: the human may have written in the note while the side quest went.
      const current = await this.deps.app.vault.cachedRead(file)
      await this.deps.app.vault.modify(file, appendSideQuestResult(current, quest, { runId, ...(url ? { url } : {}) }, result))
      return true
    })
    if (wrote) notify(`Side quest ran as ${runId}`)
  }
}
