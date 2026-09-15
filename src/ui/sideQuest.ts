import type { App } from 'obsidian'
import { guardWrite } from './vaultWrite'
import { fetchRun } from './rerunAndRefresh'
import { runHeadless } from '../run/headlessRun'
import { holdHeading, proposalEdits, proposerPanels } from '../run/holdNote'
import { runViewUrl } from '../run/provenance'
import { appendSideQuestResult, pendingSideQuest, type SideQuestRun, type SideQuestTurn } from '../run/sideQuest'
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
    const { app, notify } = this.deps
    const file = app.workspace.getActiveFile()
    const content = file?.extension === 'md' ? await app.vault.cachedRead(file) : ''
    if (!file || !holdHeading(content)) {
      notify(NOT_A_HOLD_NOTE)
      return
    }

    const quest = pendingSideQuest(content)
    if (!quest) {
      notify(NOTHING_TO_QUEST)
      return
    }

    const run = await this.send(content, quest)
    if (!run) return

    const wrote = await guardWrite(notify, 'the hold note', async () => {
      // Read again: the human may have written in the note while the side quest went.
      const current = await this.deps.app.vault.cachedRead(file)
      await this.deps.app.vault.modify(file, appendSideQuestResult(current, quest, run))
      return true
    })
    if (wrote) notify(`Side quest ran as ${run.runId}`)
  }

  /**
   * The proposal, as the hold note `content` has it, run through the quest's chain;
   * `undefined`, once it has said why, when no result came back.
   */
  async send(content: string, quest: SideQuestTurn): Promise<SideQuestRun | undefined> {
    const { engine, notify } = this.deps
    const heading = holdHeading(content)
    const source = heading && (await this.deps.withEngine(() => fetchRun(engine, heading.runId)))
    if (!source) return undefined

    const panel = proposerPanels(source.layout.panels).find(candidate => candidate.name === quest.name)
    if (!panel) {
      notify(NOT_A_PROPOSER(quest.name))
      return undefined
    }
    const seed = proposalEdits(content, source.layout.panels)[panel.node] ?? panel.text.trim()

    const outcome = await this.deps.withEngine(() => runHeadless(engine, { chainName: quest.chainName, seedPrompt: seed }))
    if (!outcome) return undefined
    const runId = outcome.runId
    if (!runId) {
      notify(outcome.error ? `Side quest failed: ${outcome.error}` : 'Side quest produced no run')
      return undefined
    }
    if (outcome.error) {
      notify(`Side quest run ${runId} failed: ${outcome.error}`)
      return undefined
    }

    const landed = await this.deps.withEngine(() => engine.getRun(runId))
    if (!landed) return undefined
    const url = this.runUrl(runId)
    return { runId, ...(url ? { url } : {}), result: landed.agentOutputs.at(-1)?.output ?? '' }
  }

  /** The chains a quest can go through; none, without a notice, while the engine cannot say. */
  chains(): Promise<string[]> {
    return this.deps.engine.listChains().then(
      chains => chains.map(chain => chain.name),
      () => [],
    )
  }

  runUrl(runId: string): string | undefined {
    return runViewUrl(this.deps.engineUrl(), runId)
  }
}
