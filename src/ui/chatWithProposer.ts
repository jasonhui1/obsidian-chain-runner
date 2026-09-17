import { normalizePath, type App, type TFile } from 'obsidian'
import { guardWrite, readIfPresent } from './vaultWrite'
import { fetchRun, rerunAndRefresh, type FetchedRun } from './rerunAndRefresh'
import { CANON_PATH } from '../run/canon'
import { appendChatReply, chatSeed, latestOutput, markRevised, pendingMessage, pendingRevise, type ChatReply, type ChatTurn } from '../run/chat'
import { runAgentOnce } from '../run/headlessRun'
import { chatReply, repliesSoFar } from '../run/proposerChat'
import { holdHeading, proposerPanels, type HoldHeading } from '../run/holdNote'
import { rerunRequest } from '../run/rerun'
import type { OnRerunProgress } from '../run/rerunProgress'
import type { EngineClient } from '../engine/client'
import type { RerunWatch } from '../run/rerunWatch'

/**
 * The "Chat with proposer" command: the vault half of `src/run/chat.ts`. The
 * call itself is `src/run/proposerChat.ts` — the engine continuing that node's
 * own transcript, or, on an engine without that endpoint, an approximate chat.
 */

export const NOT_A_HOLD_NOTE = 'Open a hold note to chat with a proposer'
export const NOTHING_TO_SEND = 'Nothing new in the Conversation section to send'
export const NOT_A_PROPOSER = (name: string): string => `@${name} is not a proposer — only proposers can be chatted with`

export interface ChatWithProposerDeps {
  app: App
  engine: EngineClient
  withEngine: <T>(action: () => Promise<T>) => Promise<T | undefined>
  notify: (message: string) => void
  reruns: RerunWatch
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
    if (revise?.reply !== undefined) {
      await this.revise(file, heading, { ...revise, reply: revise.reply })
      return
    }

    const pending = pendingMessage(content)
    if (!pending) {
      notify(NOTHING_TO_SEND)
      return
    }
    const reply = await this.reply(heading.runId, pending.name, pending.message)
    if (reply === undefined) return

    const wrote = await guardWrite(notify, 'the hold note', async () => {
      // Read again: the human may have written in the note while the chat went.
      const current = await this.deps.app.vault.cachedRead(file)
      await this.deps.app.vault.modify(file, appendChatReply(current, pending, reply))
      return true
    })
    if (wrote) notify(`${pending.name} replied`)
  }

  /**
   * One more turn of the proposer's own transcript, with the turn number the
   * engine counted it as; `undefined`, once it has said why, when there is no
   * reply. An engine without the chat endpoint falls back to `approximate`.
   */
  async reply(runId: string, name: string, message: string): Promise<ChatReply | undefined> {
    const { engine, notify } = this.deps
    const source = await this.deps.withEngine(() => fetchRun(engine, runId))
    if (!source) return undefined

    const panel = proposerPanels(source.layout.panels).find(candidate => candidate.name === name)
    if (!panel) {
      notify(NOT_A_PROPOSER(name))
      return undefined
    }

    const outcome = await this.deps.withEngine(async () => {
      const { capabilities } = await engine.loadWorkspace()
      return chatReply(engine, capabilities, { runId, nodeId: panel.node, name, message })
    })
    if (!outcome) return undefined
    if (outcome.kind === 'unsupported') return this.approximate(source, panel.node, name, message)
    if (outcome.kind === 'refused') {
      notify(outcome.said)
      return undefined
    }
    return { text: outcome.text, turn: await this.turnOf(runId, panel.node, repliesSoFar(source.run.agentOutputs, panel.node)) }
  }

  /**
   * Which turn of the node's transcript the reply just written is. The engine's
   * own count, re-read once it has recorded the turn; only an engine that has
   * not is counted on from `before`, the replies it held when the message went.
   */
  private async turnOf(runId: string, nodeId: string, before: number): Promise<number> {
    const after = await this.deps.withEngine(() => this.deps.engine.getRun(runId))
    const counted = after ? repliesSoFar(after.agentOutputs, nodeId) : 0
    return counted > before ? counted : before + 1
  }

  /**
   * Approximate chat, for an engine with no chat endpoint (#54): a fresh,
   * standalone call to the proposer's agent, seeded with what fed it last time
   * and what it answered. Nothing is continued, so the reply has no turn.
   */
  private async approximate(source: FetchedRun, nodeId: string, name: string, message: string): Promise<ChatReply | undefined> {
    const { engine, notify } = this.deps
    const seed = chatSeed(source.run, nodeId, message)
    const agentName = latestOutput(source.run.agentOutputs, nodeId)?.agentName
    if (seed === undefined || agentName === undefined) {
      notify(NOT_A_PROPOSER(name))
      return undefined
    }

    const outcome = await this.deps.withEngine(() => runAgentOnce(engine, { agentName, seedPrompt: seed }))
    if (!outcome) return undefined
    if (outcome.error) {
      notify(`Chat with ${name} failed: ${outcome.error}`)
      return undefined
    }
    if (!outcome.output) {
      notify(`Chat with ${name} produced no reply`)
      return undefined
    }
    return { text: outcome.output.output }
  }

  /**
   * A reply becomes the proposer's revision, rerun downstream; `mark` notes in the
   * hold which reply it was, and `onProgress` hears each step. Answers the run the hold now lives under.
   */
  async revise(
    file: TFile,
    heading: HoldHeading,
    turn: Required<ChatTurn>,
    mark: (content: string, newRunId: string) => string = markRevised,
    onProgress?: OnRerunProgress,
  ): Promise<string | undefined> {
    const { engine, notify } = this.deps
    const source = await this.deps.withEngine(() => fetchRun(engine, heading.runId))
    if (!source) return undefined

    const panel = proposerPanels(source.layout.panels).find(candidate => candidate.name === turn.name)
    if (!panel) {
      notify(NOT_A_PROPOSER(turn.name))
      return undefined
    }

    const canon = await readIfPresent(this.deps.app, normalizePath(CANON_PATH))
    const request = rerunRequest(source.run, source.layout.panels, { [panel.node]: turn.reply }, canon)
    if (!request) {
      notify(`Run ${heading.runId} carries no graph to rerun from`)
      return undefined
    }

    return rerunAndRefresh(this.deps, file, heading, request, {
      beforeRefresh: mark,
      onProgress,
      edits: { before: source.layout.panels, sent: {}, revised: panel.node },
    })
  }
}
