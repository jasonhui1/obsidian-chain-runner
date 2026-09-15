import { normalizePath, type App, type TFile } from 'obsidian'
import { guardWrite, readIfPresent } from './vaultWrite'
import { fetchRun, rerunAndRefresh } from './rerunAndRefresh'
import { CANON_PATH } from '../run/canon'
import { appendChatReply, chatSeed, latestOutput, markRevised, pendingMessage, pendingRevise, type ChatTurn } from '../run/chat'
import { runAgentOnce } from '../run/headlessRun'
import { holdHeading } from '../run/holdNote'
import { rerunRequest } from '../run/rerun'
import type { EngineClient } from '../engine/client'

/** The "Chat with proposer" command: the vault half of `src/run/chat.ts`. */

export const NOT_A_HOLD_NOTE = 'Open a hold note to chat with a proposer'
export const NOTHING_TO_SEND = 'Nothing new in the Conversation section to send'
export const NOT_A_PROPOSER = (name: string): string => `@${name} is not a proposer — only proposers can be chatted with`

export interface ChatWithProposerDeps {
  app: App
  engine: EngineClient
  withEngine: <T>(action: () => Promise<T>) => Promise<T | undefined>
  notify: (message: string) => void
}

export class ChatWithProposer {
  constructor(private readonly deps: ChatWithProposerDeps) {}

  async start(): Promise<void> {
    const { app, notify } = this.deps
    const file = app.workspace.getActiveFile()
    const content = file?.extension === 'md' ? await app.vault.cachedRead(file) : ''
    const heading = holdHeading(content)
    if (!file || !heading) {
      notify(NOT_A_HOLD_NOTE)
      return
    }

    const revise = pendingRevise(content)
    if (revise) {
      await this.revise(file, heading, revise)
      return
    }

    const pending = pendingMessage(content)
    if (!pending) {
      notify(NOTHING_TO_SEND)
      return
    }
    await this.chat(file, heading, pending)
  }

  /** `@name message`: a fresh, standalone call to that proposer's agent, its reply appended. */
  private async chat(file: TFile, heading: { runId: string; chainName: string }, pending: ChatTurn): Promise<void> {
    const { engine, notify } = this.deps
    const source = await this.deps.withEngine(() => fetchRun(engine, heading.runId))
    if (!source) return

    const panel = source.layout.panels.find(candidate => candidate.emphasis !== 'join' && candidate.name === pending.name)
    const seed = panel && chatSeed(source.run, panel.node, pending.message)
    const agentName = panel && latestOutput(source.run.agentOutputs, panel.node)?.agentName
    if (!panel || seed === undefined || agentName === undefined) {
      notify(NOT_A_PROPOSER(pending.name))
      return
    }

    const outcome = await this.deps.withEngine(() => runAgentOnce(engine, { agentName, seedPrompt: seed }))
    if (!outcome) return
    if (outcome.error) {
      notify(`Chat with ${pending.name} failed: ${outcome.error}`)
      return
    }
    if (!outcome.output) {
      notify(`Chat with ${pending.name} produced no reply`)
      return
    }
    const reply = outcome.output.output

    const wrote = await guardWrite(notify, 'the hold note', async () => {
      // Read again: the human may have written in the note while the chat went.
      const current = await this.deps.app.vault.cachedRead(file)
      await this.deps.app.vault.modify(file, appendChatReply(current, pending, reply))
      return true
    })
    if (wrote) notify(`${pending.name} replied`)
  }

  /** A bare `revise` below a reply: that reply becomes the node's revision, rerun-downstream. */
  private async revise(file: TFile, heading: { runId: string; chainName: string }, revise: ChatTurn): Promise<void> {
    const { engine, notify } = this.deps
    const source = await this.deps.withEngine(() => fetchRun(engine, heading.runId))
    if (!source) return

    const panel = source.layout.panels.find(candidate => candidate.emphasis !== 'join' && candidate.name === revise.name)
    if (!panel || revise.reply === undefined) {
      notify(NOT_A_PROPOSER(revise.name))
      return
    }

    const canon = await readIfPresent(this.deps.app, normalizePath(CANON_PATH))
    const request = rerunRequest(source.run, source.layout.panels, { [panel.node]: revise.reply }, canon)
    if (!request) {
      notify(`Run ${heading.runId} carries no graph to rerun from`)
      return
    }

    await rerunAndRefresh(this.deps, file, heading, request, markRevised)
  }
}
