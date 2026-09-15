import type { App } from 'obsidian'
import { guardWrite } from './vaultWrite'
import { fetchRun } from './rerunAndRefresh'
import { appendRoomAnswers, pendingRoomQuestion, type RoomAnswer } from '../run/askRoom'
import { chatSeed, latestOutput } from '../run/chat'
import { runAgentOnce } from '../run/headlessRun'
import { holdHeading, proposerPanels } from '../run/holdNote'
import type { EngineClient } from '../engine/client'

/** The "Ask the room" command: the vault half of `src/run/askRoom.ts`. */

export const NOT_A_HOLD_NOTE = 'Open a hold note to ask the room'
export const NOTHING_TO_ASK = 'Nothing new in the Conversation section to ask the room'
export const NOBODY_ANSWERED = 'Nobody in the room answered'

export interface AskTheRoomDeps {
  app: App
  engine: EngineClient
  withEngine: <T>(action: () => Promise<T>) => Promise<T | undefined>
  notify: (message: string) => void
}

export class AskTheRoom {
  constructor(private readonly deps: AskTheRoomDeps) {}

  async start(): Promise<void> {
    const { app, notify } = this.deps
    const file = app.workspace.getActiveFile()
    const content = file?.extension === 'md' ? await app.vault.cachedRead(file) : ''
    const heading = holdHeading(content)
    if (!file || !heading) {
      notify(NOT_A_HOLD_NOTE)
      return
    }

    const question = pendingRoomQuestion(content)
    if (!question) {
      notify(NOTHING_TO_ASK)
      return
    }

    const answers = await this.answers(heading.runId, question)
    if (!answers) return

    const wrote = await guardWrite(notify, 'the hold note', async () => {
      // Read again: the human may have written in the note while the room went.
      const current = await this.deps.app.vault.cachedRead(file)
      await this.deps.app.vault.modify(file, appendRoomAnswers(current, question, answers))
      return true
    })
    if (wrote) notify(`The room answered (${answers.length})`)
  }

  /** Every proposer's answer to `question`, one at a time; `undefined`, once it has said why, when nobody answered. */
  async answers(runId: string, question: string): Promise<RoomAnswer[] | undefined> {
    const { engine, notify } = this.deps
    const answers = await this.deps.withEngine(async () => {
      const source = await fetchRun(engine, runId)
      const gathered: RoomAnswer[] = []
      for (const panel of proposerPanels(source.layout.panels)) {
        const seed = chatSeed(source.run, panel.node, question)
        const agentName = latestOutput(source.run.agentOutputs, panel.node)?.agentName
        if (seed === undefined || agentName === undefined) continue
        const outcome = await runAgentOnce(engine, { agentName, seedPrompt: seed })
        if (outcome.output) gathered.push({ name: panel.name, answer: outcome.output.output })
      }
      return gathered
    })
    if (!answers) return undefined
    if (answers.length === 0) {
      notify(NOBODY_ANSWERED)
      return undefined
    }
    return answers
  }
}
