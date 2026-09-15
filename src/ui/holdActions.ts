import type { App, TAbstractFile } from 'obsidian'
import type { AskTheRoom } from './askTheRoom'
import type { ChatWithProposer } from './chatWithProposer'
import type { HoldNotes } from './holdNotes'
import { guardWrite } from './vaultWrite'
import { appendRoomQuestion } from '../run/askRoom'
import { appendChatTurn, markTurnRevised, type ChatTurn } from '../run/chat'
import {
  appendDirectionLine,
  directionLine,
  holdHeading,
  readHold,
  removeDirectionLines,
  tickCanonLine,
  type DirectionVerb,
  type HoldReading,
} from '../run/holdNote'

/**
 * Hold actions: everything the directing panel reads from a hold or does to it,
 * as plain data. Backed by the hold note; only this module knows that.
 */

export { DIRECTION_VERBS, type CanonChoice, type DirectionVerb, type HoldProposal, type HoldReading } from '../run/holdNote'
export type { ConversationEntry } from '../run/conversation'
export type { RoomAnswer } from '../run/askRoom'

/** A chat reply that can become its proposal's revision. */
export type RepliedTurn = Required<ChatTurn>

export interface HoldActionsDeps {
  app: App
  notify: (message: string) => void
  notes: HoldNotes
  /** Writes a run's hold from what the engine recorded. */
  write: (runId: string) => Promise<unknown>
  chat: ChatWithProposer
  room: AskTheRoom
}

export class HoldActions {
  constructor(private readonly deps: HoldActionsDeps) {}

  /** The run's hold, or `undefined` when none has been written. */
  async read(runId: string): Promise<HoldReading | undefined> {
    const file = this.deps.notes.find(runId)
    return file ? readHold(await this.deps.app.vault.cachedRead(file)) : undefined
  }

  /** A verb given to a proposal; COMBINE names the second proposal it joins. */
  direct(runId: string, verb: DirectionVerb, proposal: string, other?: string): Promise<boolean> {
    return this.edit(runId, content => appendDirectionLine(content, directionLine(verb, proposal, other)))
  }

  /** A verb taken back off a proposal; a COMBINE whichever way round it was written. */
  undirect(runId: string, verb: DirectionVerb, proposal: string, other?: string): Promise<boolean> {
    const lines = [directionLine(verb, proposal, other), ...(other ? [directionLine(verb, other, proposal)] : [])]
    return this.edit(runId, content => removeDirectionLines(content, lines))
  }

  /** A canon line, by its `id`, ticked or unticked. */
  tickCanon(runId: string, id: string, ticked: boolean): Promise<boolean> {
    return this.edit(runId, content => tickCanonLine(content, id, ticked))
  }

  /** A free-text CHANGE line in the Direction; whether it was written. */
  change(runId: string, text: string): Promise<boolean> {
    const change = oneLine(text)
    return change === '' ? Promise.resolve(false) : this.edit(runId, content => appendDirectionLine(content, `CHANGE: ${change}`))
  }

  /** A message to one proposer; its reply, once there is one, is kept with it. Whether both were written. */
  async chat(runId: string, proposal: string, message: string): Promise<boolean> {
    const said = oneLine(message)
    if (said === '' || !this.deps.notes.find(runId)) return false
    const reply = await this.deps.chat.reply(runId, proposal, said)
    return reply !== undefined && this.edit(runId, content => appendChatTurn(content, { name: proposal, message: said }, reply))
  }

  /** A question to every proposer, kept with their answers. Whether it was written. */
  async askRoom(runId: string, question: string): Promise<boolean> {
    const asked = oneLine(question)
    if (asked === '' || !this.deps.notes.find(runId)) return false
    const answers = await this.deps.room.answers(runId, asked)
    return answers !== undefined && this.edit(runId, content => appendRoomQuestion(content, asked, answers))
  }

  /** A reply made its proposal's revision and rerun downstream; answers the run the hold now lives under. */
  async revise(runId: string, turn: RepliedTurn): Promise<string | undefined> {
    const file = this.deps.notes.find(runId)
    const heading = file && holdHeading(await this.deps.app.vault.cachedRead(file))
    if (!file || !heading) return undefined
    return this.deps.chat.revise(file, heading, turn, (content, newRunId) => markTurnRevised(content, turn, newRunId))
  }

  /** Writes the hold for a run that has none. */
  async writeHold(runId: string): Promise<void> {
    await this.deps.write(runId)
  }

  async openInTab(runId: string): Promise<void> {
    const file = this.deps.notes.find(runId)
    if (file) await this.deps.app.workspace.getLeaf('tab').openFile(file)
  }

  /** Calls `listener` whenever the run's hold changes, by any hand; returns what stops it. */
  onChange(runId: string, listener: () => void): () => void {
    const vault = this.deps.app.vault
    const path = this.deps.notes.pathOf(runId)
    const heard = (file: TAbstractFile): void => {
      if (file.path === path) listener()
    }
    const refs = [vault.on('modify', heard), vault.on('create', heard), vault.on('delete', heard)]
    return () => refs.forEach(ref => vault.offref(ref))
  }

  /** Whether the edit reached the note. */
  private async edit(runId: string, change: (content: string) => string): Promise<boolean> {
    const file = this.deps.notes.find(runId)
    if (!file) return false
    const wrote = await guardWrite(this.deps.notify, 'the hold note', async () => {
      await this.deps.app.vault.process(file, change)
      return true
    })
    return wrote === true
  }
}

/** The note keeps each message, question and change on a line of its own. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
