import type { App, TAbstractFile, TFile } from 'obsidian'
import type { AskTheRoom } from './askTheRoom'
import type { ChatWithProposer } from './chatWithProposer'
import type { HoldNotes } from './holdNotes'
import type { RerunDownstream } from './rerunDownstream'
import type { RunPanels } from './runPanels'
import { guardWrite } from './vaultWrite'
import { appendRoomQuestion } from '../run/askRoom'
import { appendChatTurn, markTurnRevised, type ChatTurn } from '../run/chat'
import {
  appendDirectionLine,
  directionLine,
  holdHeading,
  readHold,
  removeDirectionLines,
  rewriteProposal,
  tickCanonLine,
  type DirectionVerb,
  type HoldHeading,
  type HoldReading,
} from '../run/holdNote'

/**
 * Hold actions: everything the directing panel reads from a hold or does to it,
 * as plain data. Backed by the hold note; only this module knows that.
 */

export { DIRECTION_VERBS, type CanonChoice, type DirectionVerb, type HoldProposal, type HoldReading } from '../run/holdNote'
export type { ConversationEntry } from '../run/conversation'
export { sameTurn } from '../run/chat'
export type { RoomAnswer } from '../run/askRoom'

/** A chat reply that can become its proposal's revision. */
export type RepliedTurn = Required<ChatTurn>

export const PROPOSAL_HEADING = 'A proposal cannot hold a “### ” heading: the hold note starts the next proposal there'

export interface HoldActionsDeps {
  app: App
  notify: (message: string) => void
  notes: HoldNotes
  /** Writes a run's hold from what the engine recorded. */
  write: (runId: string) => Promise<unknown>
  chat: ChatWithProposer
  room: AskTheRoom
  rerun: RerunDownstream
  /** What each run wrote, which tells an edited proposal from one left as it was. */
  panels: RunPanels
}

export class HoldActions {
  constructor(private readonly deps: HoldActionsDeps) {}

  /** The run's hold, or `undefined` when none has been written. */
  async read(runId: string): Promise<HoldReading | undefined> {
    const file = this.deps.notes.find(runId)
    if (!file) return undefined
    const [content, panels] = await Promise.all([this.deps.app.vault.cachedRead(file), this.deps.panels.of(runId)])
    return readHold(content, panels ?? [])
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

  /** A proposal's words, rewritten; whether they were written. */
  async editProposal(runId: string, proposal: string, text: string): Promise<boolean> {
    if (text.trim() === '') return false
    if (/^### /m.test(text)) {
      this.deps.notify(PROPOSAL_HEADING)
      return false
    }
    const found = await this.holdFile(runId)
    const exists = found && readHold(found.content, [])?.proposals.some(one => one.name === proposal)
    return exists === true && this.edit(runId, content => rewriteProposal(content, proposal, text))
  }

  /** The edited proposals rerun downstream; answers the run the hold now lives under. */
  async rerun(runId: string): Promise<string | undefined> {
    const found = await this.holdFile(runId)
    return found && this.deps.rerun.rerun(found.file, found.content)
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
    const found = await this.holdFile(runId)
    return found && this.deps.chat.revise(found.file, found.heading, turn, (content, newRunId) => markTurnRevised(content, turn, newRunId))
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

  /** The run's hold note, when it has one. */
  private async holdFile(runId: string): Promise<{ file: TFile; heading: HoldHeading; content: string } | undefined> {
    const file = this.deps.notes.find(runId)
    if (!file) return undefined
    const content = await this.deps.app.vault.cachedRead(file)
    const heading = holdHeading(content)
    return heading && { file, heading, content }
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
