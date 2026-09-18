import { readFront, type NoteStore } from './noteStore'
import { guardWrite } from './vaultWrite'
import { fetchRun } from './rerunAndRefresh'
import { appendRoomAnswers, pendingRoomQuestion, type RoomAnswer } from '../run/askRoom'
import { chatSeed, latestOutput } from '../run/chat'
import { launch } from '../run/answer'
import { holdHeading, proposerPanels } from '../run/holdNote'
import type { EngineClient } from '../engine/client'

/** The "Ask the room" command: the vault half of `src/run/askRoom.ts`. */

export const NOT_A_HOLD_NOTE = 'Open a hold note to ask the room'
export const NOTHING_TO_ASK = 'Nothing new in the Conversation section to ask the room'
export const NOBODY_ANSWERED = 'Nobody in the room answered'

export interface AskTheRoomDeps {
  store: NoteStore
  engine: EngineClient
  withEngine: <T>(action: () => Promise<T>) => Promise<T | undefined>
  notify: (message: string) => void
}

export class AskTheRoom {
  constructor(private readonly deps: AskTheRoomDeps) {}

  async start(): Promise<void> {
    const { store, notify } = this.deps
    const { path, content } = (await readFront(store)) ?? { content: '' }
    const heading = holdHeading(content)
    if (!path || !heading) {
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
      const current = (await store.read(path)) ?? ''
      await store.modify(path, appendRoomAnswers(current, question, answers))
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
        const answered = await launch(engine, { agentName, seedPrompt: seed })
        // A refusal is the engine's, not the proposer's: nobody else would be heard either.
        if (answered.kind === 'refused') {
          notify(answered.said)
          return undefined
        }
        if (answered.reply !== undefined) gathered.push({ name: panel.name, answer: answered.reply })
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
