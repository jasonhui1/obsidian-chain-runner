import { normalizePath } from 'obsidian'
import { folderOf, type NoteStore } from './noteStore'
import { RunPanels } from './runPanels'
import { ensureFolder, guardWrite } from './vaultWrite'
import { launch, type Answer, type OnEvent } from '../run/answer'
import { appendRoomAnswers, appendRoomTrigger, type RoomAnswer } from '../run/askRoom'
import { appendCanon, CANON_PATH, tickedCanonLines } from '../run/canon'
import {
  appendChatReply,
  appendChatTrigger,
  chatSeed,
  latestOutput,
  markRevised,
  markTurnRevised,
  pendingRevise,
  type ChatReply,
  type RepliedTurn,
} from '../run/chat'
import type { ConversationEntry } from '../run/conversation'
import {
  appendDirectionLine,
  appendResumeLink,
  directionBlock,
  directionLine,
  directionLines,
  editsToCarry,
  holdHeading,
  holdNoteContent,
  holdNoteInput,
  holdNotePath,
  mergeHoldNote,
  proposalEdits,
  readHold,
  refreshHoldNote,
  removeDirectionLines,
  earlierRunsIn,
  rewriteProposal,
  tickCandidate,
  tickCanonLine,
  waitingHoldsIn,
  type DirectionVerb,
  type HoldHeading,
  type HoldReading,
  type RerunEdits,
} from '../run/holdNote'
import { proposerPanels } from '../run/panels'
import { runPromote } from '../run/promote'
import { chatReply, repliesSoFar } from '../run/proposerChat'
import { rerunRequest, runFork } from '../run/rerun'
import { RerunProgressTracker } from '../run/rerunProgress'
import type { RerunCause, RerunReport, RerunWatch } from '../run/rerunWatch'
import { resumeRequest, runResume } from '../run/resume'
import { appendSideQuestResult, appendSideQuestTrigger, type SideQuestRun, type SideQuestTurn } from '../run/sideQuest'
import type { EngineClient } from '../engine/client'
import { engineFailureMessage } from '../engine/guard'
import { waitingHolds, type LayoutModel, type LayoutPanel, type RunMeta } from '../engine/types'

/**
 * The hold module: reads a hold note, calls the engine, writes the note and
 * answers what the hold now is (ADR-0015). The directing panel, the palette and
 * the direction buttons are its callers; nothing else writes a hold note.
 */

export { DIRECTION_VERBS, type DirectionVerb } from '../run/holdNote'

/** Which trigger line a palette send answers. */
export type TriggerKind = 'chat' | 'room' | 'quest'

export const NO_HOLD_NOTE = (runId: string): string => `Run ${runId} has no hold note yet`
export const NO_SUCH_PROPOSAL = (name: string): string => `This hold has no proposal named ${name}`
export const NOTHING_TYPED = 'Nothing to write in the hold note'
export const PROPOSAL_HEADING = 'A proposal cannot hold a “### ” heading: the hold note starts the next proposal there'
export const NOTHING_PENDING: Record<TriggerKind, string> = {
  chat: 'Nothing new in the Conversation section to send',
  room: 'Nothing new in the Conversation section to ask the room',
  quest: 'Nothing new in the Conversation section to send on a side quest',
}
export const NOT_A_PROPOSER = (name: string): string => `@${name} is not a proposer — only proposers can be chatted with`
export const NOT_A_QUEST_PROPOSER = (name: string): string => `@${name} is not a proposer — only a proposal can go on a side quest`
export const REPLY_NOT_ON_ENGINE = (name: string): string =>
  `This reply never reached the engine, so it cannot become ${name}'s proposal — ask ${name} again first`
export const NOBODY_ANSWERED = 'Nobody in the room answered'
export const NO_EDITED_PROPOSAL = 'Edit a proposal in this hold note first'
export const ALREADY_GOING = 'This hold is already rerunning or resuming — wait for it to land'

/** A trigger line in the Conversation with no answer under it yet. */
export type PendingTrigger =
  | { kind: 'chat'; name: string; message: string }
  | { kind: 'revise'; turn: RepliedTurn }
  | { kind: 'room'; question: string }
  | { kind: 'quest'; name: string; chain: string }

/** A trigger line the engine answers, rather than a `revise` it lands. */
type Trigger = Exclude<PendingTrigger, { kind: 'revise' }>

/** The hold as it now reads, under the run it now lives under. */
export type Hold = HoldReading & { pending?: PendingTrigger }

/** What a call that moved the hold answers: a fork's own hold for a fork. */
export interface Landing {
  hold: Hold
  forked: boolean
  error?: string
}

/** What became of the hold's ticked CANON? lines (#32: they land only on a run that succeeded). */
export type CanonOutcome = 'written' | 'held-back' | 'none'

export type Resumed = Landing & { canon: CanonOutcome }

/** Whether a send made a revise and landed, rather than answering under its line. */
export function isLanding(sent: Hold | Landing): sent is Landing {
  return 'forked' in sent
}

/** How the panel and the palette both name what became of the ticks; empty when there were none. */
export function canonNote(canon: CanonOutcome): string {
  if (canon === 'none') return ''
  return canon === 'written' ? 'canon written' : 'canon not written'
}

export interface HoldsDeps {
  store: NoteStore
  engine: EngineClient
  withEngine: <T>(action: () => Promise<T>) => Promise<T | undefined>
  notify: (message: string) => void
  /** Hears every rerun, revise and resume from its start, and says which are going. */
  reruns: RerunWatch
  /** Where a run is shown on the engine, for the links the note keeps (ADR-0004). */
  runUrl: (runId: string) => string | undefined
}

/** A hold note found and read. */
interface Located {
  path: string
  content: string
  heading: HoldHeading
  /** The run it is under, then its earlier runs: every id the hold is found by. */
  runIds: string[]
}

interface FetchedRun {
  run: RunMeta
  layout: LayoutModel
}

/** How the notices name what a landing call fired; any caveat is added after the stem. */
interface LandingWording {
  landed: (runId: string, forked: boolean) => string
  /** The run landed, but the note could not be folded onto it. */
  heldBack: (runId: string) => string
  /** `runId` only once the engine had named a run, and `error` only if it said why. */
  failed: (runId: string | undefined, error: string | undefined) => string
}

const CANON_NOTE = normalizePath(CANON_PATH)

const RERUN_DOWNSTREAM_WORDING: LandingWording = {
  landed: runId => `Reran downstream as run ${runId}`,
  heldBack: runId => `Reran as run ${runId}`,
  failed: (runId, error) => (runId ? `Rerun ${runId} failed: ${error}` : error ? `Rerun failed: ${error}` : 'Rerun produced no run'),
}

function reviseWording(name: string): LandingWording {
  const became = `${name}'s reply is now the proposal`
  return {
    landed: (runId, forked) => (forked ? `${became} — forked as run ${runId}` : `${became} — run ${runId} reran`),
    heldBack: runId => `${became}, and run ${runId} reran`,
    failed: (runId, error) => {
      if (runId) return `Run ${runId} failed after using ${name}'s reply: ${error}`
      return error ? `Using ${name}'s reply as the revision failed: ${error}` : `Using ${name}'s reply as the revision produced no run`
    },
  }
}

interface LandingOptions {
  /** Edits the freshly re-read note before folding: a revise marks its line done. */
  beforeRefresh?: (content: string, newRunId: string) => string
  /** Decides which edits made meanwhile outlive the refresh. */
  edits: Omit<RerunEdits, 'landed'>
  wording: LandingWording
}

export class Holds {
  private readonly panels: RunPanels

  constructor(private readonly deps: HoldsDeps) {
    this.panels = new RunPanels(deps.engine)
  }

  /** The run's hold, wherever a rerun moved it; `undefined`, quietly, without a note. */
  async read(runId: string): Promise<Hold | undefined> {
    const found = await this.locate(runId)
    return found && this.reading(found)
  }

  /** The hold note in front of the reader; `undefined`, quietly, for any other note. */
  async front(): Promise<Hold | undefined> {
    const path = this.deps.store.front()?.path
    const content = path === undefined ? undefined : await this.deps.store.read(path)
    const heading = content === undefined ? undefined : holdHeading(content)
    return heading && this.read(heading.runId)
  }

  /** Calls `listener` whenever the run's hold note changes, by any hand; returns what stops it. */
  onChange(runId: string, listener: () => void): () => void {
    const path = this.pathOf(runId)
    return this.deps.store.onChange(changed => {
      if (changed === path) listener()
    })
  }

  /** The hold written from what the engine recorded: created, or merged onto what the human wrote. */
  async write(runId: string, chainName?: string): Promise<Hold | undefined> {
    const current = await this.currentRun(runId)
    const fetched = await this.deps.withEngine(() => fetchRun(this.deps.engine, current))
    return fetched && this.writeFetched(fetched, chainName)
  }

  /** The hold rewritten only when the engine's open holds differ from the note's; quiet on a silent engine. */
  async refresh(runId: string): Promise<Hold | undefined> {
    const found = await this.locate(runId)
    if (!found) return undefined
    const { engine } = this.deps
    const current = found.heading.runId
    try {
      const open = waitingHolds((await engine.waitingRun(current))?.holds).map(hold => hold.nodeId)
      const shown = waitingHoldsIn(found.content).map(hold => hold.nodeId)
      if (open.join('\n') !== shown.join('\n')) await this.writeFetched(await fetchRun(engine, current))
    } catch (error) {
      if (engineFailureMessage(error) === undefined) throw error
    }
    return this.read(current)
  }

  async open(runId: string): Promise<void> {
    const found = await this.locateOrRefuse(runId)
    if (found) await this.deps.store.open(found.path)
  }

  /** A verb given to a proposal; COMBINE names the second proposal it joins. */
  direct(runId: string, verb: DirectionVerb, proposal: string, other?: string): Promise<Hold | undefined> {
    return this.edit(runId, content => appendDirectionLine(content, directionLine(verb, proposal, other)))
  }

  /** A verb taken back off a proposal; a COMBINE whichever way round it was written. */
  undirect(runId: string, verb: DirectionVerb, proposal: string, other?: string): Promise<Hold | undefined> {
    const lines = [directionLine(verb, proposal, other), ...(other ? [directionLine(verb, other, proposal)] : [])]
    return this.edit(runId, content => removeDirectionLines(content, lines))
  }

  /** A canon line, by its `id`, ticked or unticked. */
  tickCanon(runId: string, id: string, ticked: boolean): Promise<Hold | undefined> {
    return this.edit(runId, content => tickCanonLine(content, id, ticked))
  }

  /**
   * A candidate picked, by its heading — what a resume sends as `chosen` — or
   * unpicked. `hold` is the hold's name as the note shows it: `## Waiting at <hold>`.
   */
  pickCandidate(runId: string, hold: string, heading: string, ticked: boolean): Promise<Hold | undefined> {
    return this.edit(runId, content => tickCandidate(content, hold, heading, ticked))
  }

  async editProposal(runId: string, proposal: string, text: string): Promise<Hold | undefined> {
    if (text.trim() === '') return this.refuse(NOTHING_TYPED)
    if (/^### /m.test(text)) return this.refuse(PROPOSAL_HEADING)
    const found = await this.locateOrRefuse(runId)
    if (!found || !this.requireProposal(found, proposal)) return undefined
    return this.edit(runId, content => rewriteProposal(content, proposal, text))
  }

  /** A free-text CHANGE line in the Direction. */
  change(runId: string, text: string): Promise<Hold | undefined> {
    const change = oneLine(text)
    if (change === '') return Promise.resolve(this.refuse(NOTHING_TYPED))
    return this.edit(runId, content => appendDirectionLine(content, `CHANGE: ${change}`))
  }

  /** A `@name message` line written, then answered under it (ADR-0014). */
  chat(runId: string, proposal: string, message: string): Promise<Hold | undefined> {
    return this.triggered(runId, { kind: 'chat', name: proposal, message: oneLine(message) })
  }

  /** An `ask the room:` line written, then every proposer's answer under it. */
  askRoom(runId: string, question: string): Promise<Hold | undefined> {
    return this.triggered(runId, { kind: 'room', question: oneLine(question) })
  }

  /** A `side quest:` line written, then the proposal, as the note has it, sent through `chain`. */
  sideQuest(runId: string, proposal: string, chain: string): Promise<Hold | undefined> {
    return this.triggered(runId, { kind: 'quest', name: proposal, chain: oneLine(chain) })
  }

  /** Answers the pending trigger of `kind` a human typed; a chat ending in a bare `revise` is a revise. */
  async send(runId: string, kind: TriggerKind): Promise<Hold | Landing | undefined> {
    const found = await this.locateOrRefuse(runId)
    if (!found) return undefined
    const revise = kind === 'chat' ? pendingRevise(found.content) : undefined
    if (revise?.reply !== undefined) return this.revised(runId, { ...revise, reply: revise.reply }, markRevised)
    const trigger = unanswered(readHold(found.content, [])?.conversation ?? [], kind)
    return trigger ? this.answer(found, trigger) : this.refuse(NOTHING_PENDING[kind])
  }

  /** The edited proposals rerun downstream; the hold lands on the run that ran. */
  rerun(runId: string): Promise<Landing | undefined> {
    return this.exclusive(runId, { kind: 'edits' }, (found, report) => this.rerunDownstream(found, report))
  }

  /** A reply made its proposal's revision through the engine's promote; the hold lands where the stream names. */
  revise(runId: string, turn: RepliedTurn): Promise<Landing | undefined> {
    return this.revised(runId, turn, (content, newRunId) => markTurnRevised(content, turn, newRunId))
  }

  /** The hold answered and the run carried on: ticks locked, the run linked back, a fork given its own hold. */
  resume(runId: string): Promise<Resumed | undefined> {
    return this.exclusive(runId, { kind: 'resume' }, (found, report) => this.resumed(found, report))
  }

  private pathOf(runId: string): string {
    return normalizePath(holdNotePath(runId))
  }

  /** The run `runId`'s hold now lives under: itself, or the newest run a rerun moved its hold to. */
  private async currentRun(runId: string): Promise<string> {
    const { store } = this.deps
    const path = this.pathOf(runId)
    if (store.at(path) === 'note') return runId
    for (const hold of store.notesIn(folderOf(path))) {
      const content = (await store.read(hold)) ?? ''
      const heading = holdHeading(content)
      if (heading && earlierRunsIn(content).includes(runId)) return heading.runId
    }
    return runId
  }

  private async locate(runId: string): Promise<Located | undefined> {
    return this.noteAt(this.pathOf(await this.currentRun(runId)))
  }

  private async noteAt(path: string): Promise<Located | undefined> {
    const content = await this.deps.store.read(path)
    const heading = content === undefined ? undefined : holdHeading(content)
    if (content === undefined || !heading || directionBlock(content) === undefined) return undefined
    return { path, content, heading, runIds: [heading.runId, ...earlierRunsIn(content)] }
  }

  /** The hold as its note reads after a write. */
  private async reread(found: Located): Promise<Hold | undefined> {
    const again = await this.noteAt(found.path)
    return again && this.reading(again)
  }

  /** The hold, or a notice that there is none. */
  private async locateOrRefuse(runId: string): Promise<Located | undefined> {
    return (await this.locate(runId)) ?? this.refuse(NO_HOLD_NOTE(runId))
  }

  private async reading(found: Located): Promise<Hold | undefined> {
    const reading = readHold(found.content, (await this.panels.of(found.heading.runId)) ?? [])
    if (!reading) return undefined
    const pending = pendingIn(found.content, reading.conversation)
    return pending ? { ...reading, pending } : reading
  }

  private refuse(notice: string): undefined {
    this.deps.notify(notice)
    return undefined
  }

  /** Whether the note has the proposal; a notice when it has not. */
  private requireProposal(found: Located, name: string): boolean {
    if (readHold(found.content, [])?.proposals.some(one => one.name === name)) return true
    this.refuse(NO_SUCH_PROPOSAL(name))
    return false
  }

  /** One write to the note, answered by the hold as it then reads. */
  private async edit(runId: string, change: (content: string) => string): Promise<Hold | undefined> {
    const found = await this.locateOrRefuse(runId)
    return found && ((await this.rewrite(found, change)) ? this.reread(found) : undefined)
  }

  private async rewrite(found: Located, change: (content: string) => string): Promise<boolean> {
    return (await this.guarded('the hold note', () => this.deps.store.process(found.path, change))) !== undefined
  }

  /** A vault write the reader's setup can refuse: `undefined`, once a notice has said why. */
  private async guarded<T>(what: string, write: () => Promise<T>): Promise<Awaited<T> | { wrote: true } | undefined> {
    return guardWrite(this.deps.notify, what, async () => (await write()) ?? { wrote: true as const })
  }

  private async writeFetched({ run, layout }: FetchedRun, chainName?: string): Promise<Hold | undefined> {
    const fresh = holdNoteContent(holdNoteInput(run, layout.panels, chainName))
    const wrote = await this.writeNote(this.pathOf(run.runId), 'the hold note', previous => mergeHoldNote(fresh, previous))
    return wrote ? this.read(run.runId) : undefined
  }

  /** A trigger line written, once there is something to say, a hold to say it in, and the proposal it names; then answered. */
  private async triggered(runId: string, trigger: Trigger): Promise<Hold | undefined> {
    if (said(trigger) === '') return this.refuse(NOTHING_TYPED)
    const found = await this.locateOrRefuse(runId)
    if (!found || (trigger.kind !== 'room' && !this.requireProposal(found, trigger.name))) return undefined
    return (await this.rewrite(found, content => appendTrigger(content, trigger))) ? this.answer(found, trigger) : undefined
  }

  /** The engine asked what the trigger line asks; a failed answer leaves the line, and the hold says so with `pending`. */
  private async answer(found: Located, trigger: Trigger): Promise<Hold | undefined> {
    const { runId } = found.heading
    if (trigger.kind === 'chat') {
      const reply = await this.reply(runId, trigger.name, trigger.message)
      return this.answered(found, reply && (content => appendChatReply(content, trigger, reply)))
    }
    if (trigger.kind === 'room') {
      const answers = await this.answers(runId, trigger.question)
      return this.answered(found, answers && (content => appendRoomAnswers(content, trigger.question, answers)))
    }
    const quest = { name: trigger.name, chainName: trigger.chain }
    // The proposal as the note has it now, edits and all.
    const run = await this.runQuest(runId, (await this.deps.store.read(found.path)) ?? found.content, quest)
    return this.answered(found, run && (content => appendSideQuestResult(content, quest, run)))
  }

  /** The answer written under its trigger line; with none, the hold as it reads, the line still pending. */
  private async answered(found: Located, answer: ((content: string) => string) | undefined): Promise<Hold | undefined> {
    if (answer && !(await this.rewrite(found, answer))) return undefined
    return this.reread(found)
  }

  /**
   * One more turn of the proposer's own transcript, with the turn number the
   * engine counted it as; an engine without the chat endpoint gets an approximate reply.
   */
  private async reply(runId: string, name: string, message: string): Promise<ChatReply | undefined> {
    const { engine } = this.deps
    const found = await this.proposer(runId, name, NOT_A_PROPOSER)
    if (!found) return undefined
    const { source, panel } = found

    const answered = await this.deps.withEngine(() => chatReply(engine, { runId, nodeId: panel.node, name, message }))
    if (answered?.kind === 'refused' && answered.unsupported) return this.approximate(source, panel.node, name, message)
    const text = this.replyIn(answered, name)
    if (text === undefined) return undefined
    return { text, turn: await this.turnOf(runId, panel.node, repliesSoFar(source.run.agentOutputs, panel.node)) }
  }

  /** The run as the engine recorded it, and the proposer panel named `name` in it; `notice` when it has none. */
  private async proposer(runId: string, name: string, notice: (name: string) => string): Promise<{ source: FetchedRun; panel: LayoutPanel } | undefined> {
    const source = await this.deps.withEngine(() => fetchRun(this.deps.engine, runId))
    if (!source) return undefined
    const panel = proposerPanels(source.layout.panels).find(candidate => candidate.name === name)
    return panel ? { source, panel } : this.refuse(notice(name))
  }

  private replyIn(answered: Answer | undefined, name: string): string | undefined {
    if (!answered) return undefined
    if (answered.kind === 'refused') return this.refuse(answered.said)
    if (answered.error) return this.refuse(`Chat with ${name} failed: ${answered.error}`)
    return answered.reply ?? this.refuse(`Chat with ${name} produced no reply`)
  }

  /** The engine's own count once it has recorded the turn; counted on from `before` only when it has not. */
  private async turnOf(runId: string, nodeId: string, before: number): Promise<number> {
    const after = await this.deps.withEngine(() => this.deps.engine.getRun(runId))
    const counted = after ? repliesSoFar(after.agentOutputs, nodeId) : 0
    return counted > before ? counted : before + 1
  }

  /** A fresh call to the proposer's agent, seeded with what fed it and what it said (#54); nothing continued, so no turn. */
  private async approximate(source: FetchedRun, nodeId: string, name: string, message: string): Promise<ChatReply | undefined> {
    const ask = this.askAgent(source, nodeId, message)
    if (!ask) return this.refuse(NOT_A_PROPOSER(name))
    const text = this.replyIn(await this.deps.withEngine(ask), name)
    return text === undefined ? undefined : { text }
  }

  /** A standalone call to the node's agent, seeded with what fed it, what it said and `message`; none for a run that cannot seed one. */
  private askAgent(source: FetchedRun, nodeId: string, message: string): (() => Promise<Answer>) | undefined {
    const seed = chatSeed(source.run, nodeId, message)
    const agentName = latestOutput(source.run.agentOutputs, nodeId)?.agentName
    return seed === undefined || agentName === undefined ? undefined : () => launch(this.deps.engine, { agentName, seedPrompt: seed })
  }

  /** Every proposer's answer, one at a time; `undefined`, once it has said why, when nobody answered. */
  private async answers(runId: string, question: string): Promise<RoomAnswer[] | undefined> {
    const { engine } = this.deps
    const answers = await this.deps.withEngine(async () => {
      const source = await fetchRun(engine, runId)
      const gathered: RoomAnswer[] = []
      for (const panel of proposerPanels(source.layout.panels)) {
        const ask = this.askAgent(source, panel.node, question)
        if (!ask) continue
        const answered = await ask()
        // A refusal is the engine's, not the proposer's: nobody else would be heard either.
        if (answered.kind === 'refused') return this.refuse(answered.said)
        if (answered.reply !== undefined) gathered.push({ name: panel.name, answer: answered.reply })
      }
      return gathered
    })
    if (!answers) return undefined
    return answers.length > 0 ? answers : this.refuse(NOBODY_ANSWERED)
  }

  private async runQuest(runId: string, content: string, quest: SideQuestTurn): Promise<SideQuestRun | undefined> {
    const { engine } = this.deps
    const found = await this.proposer(runId, quest.name, NOT_A_QUEST_PROPOSER)
    if (!found) return undefined
    const { source, panel } = found
    const seed = proposalEdits(content, source.layout.panels)[panel.node] ?? panel.text.trim()

    const answered = await this.deps.withEngine(() => launch(engine, { chainName: quest.chainName, seedPrompt: seed }))
    if (!answered) return undefined
    if (answered.kind === 'refused') return this.refuse(answered.said)
    const ran = answered.runId
    if (!ran) return this.refuse(answered.error ? `Side quest failed: ${answered.error}` : 'Side quest produced no run')
    if (answered.error) return this.refuse(`Side quest run ${ran} failed: ${answered.error}`)

    const landed = await this.deps.withEngine(() => engine.getRun(ran))
    if (!landed) return undefined
    const url = this.deps.runUrl(ran)
    return { runId: ran, ...(url ? { url } : {}), result: landed.agentOutputs.at(-1)?.output ?? '' }
  }

  /**
   * One rerun, revise or resume at a time per hold, its earlier runs included, held by the watch.
   * A hold called by the run it is under is held from the call on, so a second press already finds it going.
   */
  private async exclusive<T>(runId: string, cause: RerunCause, act: (found: Located, report: RerunReport) => Promise<T | undefined>): Promise<T | undefined> {
    const { reruns, store } = this.deps
    const underIt = store.at(this.pathOf(runId)) === 'note'
    let report = underIt ? reruns.begin([runId], cause) : undefined
    if (underIt && !report) return this.refuse(ALREADY_GOING)
    try {
      const found = await this.locateOrRefuse(runId)
      if (!found) return undefined
      report ??= reruns.begin(found.runIds, cause)
      if (!report?.widen(found.runIds)) return this.refuse(ALREADY_GOING)
      return await act(found, report)
    } finally {
      report?.end()
    }
  }

  private async rerunDownstream(found: Located, report: RerunReport): Promise<Landing | undefined> {
    const { engine } = this.deps
    const { runId } = found.heading
    const source = await this.deps.withEngine(() => fetchRun(engine, runId))
    if (!source) return undefined
    const panels = source.layout.panels
    const edits = proposalEdits(found.content, panels)
    if (Object.keys(edits).length === 0) return this.refuse(NO_EDITED_PROPOSAL)
    const request = rerunRequest(source.run, panels, edits, await this.canon())
    return this.land(found, report, onEvent => runFork(engine, runId, request, onEvent), {
      edits: { before: panels, sent: edits },
      wording: RERUN_DOWNSTREAM_WORDING,
    })
  }

  private revised(
    runId: string,
    turn: RepliedTurn,
    mark: (content: string, newRunId: string) => string,
  ): Promise<Landing | undefined> {
    return this.exclusive(runId, { kind: 'reply', turn }, async (found, report) => {
      const { engine } = this.deps
      const { runId } = found.heading
      const proposer = await this.proposer(runId, turn.name, NOT_A_PROPOSER)
      if (!proposer) return undefined
      const { source, panel } = proposer
      // Only a turn the engine recorded can be promoted; an approximate reply lives in the note alone (#52).
      if (turn.turn === undefined) return this.refuse(REPLY_NOT_ON_ENGINE(turn.name))
      const canon = await this.canon()
      const promote = { runId, nodeId: panel.node, name: turn.name, turn: turn.turn, ...(canon !== undefined ? { canon } : {}) }
      return this.land(found, report, onEvent => runPromote(engine, promote, onEvent), {
        beforeRefresh: mark,
        edits: { before: source.layout.panels, sent: {}, revised: panel.node },
        wording: reviseWording(turn.name),
      })
    })
  }

  private async resumed(found: Located, report: RerunReport): Promise<Resumed | undefined> {
    const { content, heading } = found
    const direction = directionBlock(content) ?? ''
    const canon = await this.canon()
    const request = resumeRequest({ direction, said: directionLines(direction), holds: waitingHoldsIn(content), ...(canon !== undefined ? { canon } : {}) })

    const resumed = await this.deps.withEngine(() => runResume(this.deps.engine, heading.runId, request, progressTo(report)))
    if (!resumed) return undefined
    if (resumed.kind === 'refused') return this.refuse(resumed.said)
    const { runId, forked, error } = resumed
    if (!runId) return this.refuse(error ? `Resume failed: ${error}` : 'Resume produced no run')

    const locked = await this.lockCanon(tickedCanonLines(direction), error)
    const url = this.deps.runUrl(runId)
    await this.rewrite(found, now => appendResumeLink(now, { runId, forked, ...(url ? { url } : {}) }))
    const hold = forked ? await this.fork(heading, runId, report) : ((error ? await this.read(runId) : await this.refresh(runId)) ?? this.refuse(NO_HOLD_NOTE(runId)))
    return hold && { hold, forked, ...(error !== undefined ? { error } : {}), canon: locked }
  }

  /**
   * A fork is a run of its own: its hold written, and the drawing moved on to it.
   * The hold it forked from is answered either way, so it is refreshed (ADR-0013).
   */
  private async fork(origin: HoldHeading, runId: string, report: RerunReport): Promise<Hold | undefined> {
    const hold = await this.write(runId)
    await this.refresh(origin.runId)
    const layout = hold && (await this.deps.withEngine(() => this.deps.engine.getLayout(runId)))
    if (layout) await report.land({ runId, chainName: origin.chainName, panels: layout.panels })
    return hold
  }

  /** The ticks locked into canon, held back when the run failed (#32), or none to lock. */
  private async lockCanon(ticked: string[], error: string | undefined): Promise<CanonOutcome> {
    if (ticked.length === 0) return 'none'
    if (error) return 'held-back'
    // Read again right before writing, so a change made while the run went is kept.
    return (await this.writeNote(CANON_NOTE, 'the canon file', current => appendCanon(current, ticked))) ? 'written' : 'held-back'
  }

  /** A note created, or rewritten from what it held, folders and all; whether the vault took it. */
  private async writeNote(path: string, what: string, content: (previous: string | undefined) => string): Promise<boolean> {
    const { store } = this.deps
    const wrote = await this.guarded(what, async () => {
      await ensureFolder(store, folderOf(path))
      const previous = await store.read(path)
      const next = content(previous)
      if (previous === undefined) await store.create(path, next)
      else if (next !== previous) await store.modify(path, next)
    })
    return wrote !== undefined
  }

  private canon(): Promise<string | undefined> {
    return this.deps.store.read(CANON_NOTE)
  }

  /**
   * The call run, and the run it lands on folded into the note, which is then
   * named for that run. The run of record is the one the stream names (ADR-0013).
   */
  private async land(found: Located, report: RerunReport, call: (onEvent: OnEvent) => Promise<Answer>, options: LandingOptions): Promise<Landing | undefined> {
    const streamed = await this.deps.withEngine(() => call(progressTo(report)))
    if (!streamed) return undefined
    if (streamed.kind === 'refused') return this.refuse(streamed.said)
    if (!streamed.runId || streamed.error) return this.refuse(options.wording.failed(streamed.runId, streamed.error))
    return this.fold(found, streamed.runId, streamed.forked, options, report)
  }

  private async fold(found: Located, newRunId: string, forked: boolean, options: LandingOptions, report: RerunReport): Promise<Landing | undefined> {
    const { store, engine } = this.deps
    const { path, heading } = found
    const { wording } = options
    const landedRun = await this.deps.withEngine(() => fetchRun(engine, newRunId))
    if (!landedRun) return undefined
    const said = wording.landed(newRunId, forked)

    const folded = await this.guarded('the hold note', async (): Promise<{ notice: string; moved?: true }> => {
      // Read again: the human may have written in the note while the call went.
      const current = (await store.read(path)) ?? ''
      const kept = editsToCarry(current, { ...options.edits, landed: landedRun.layout.panels })
      if (!kept) return { notice: `${wording.heldBack(newRunId)}, but proposals changed meanwhile — note left as is` }
      const marked = options.beforeRefresh?.(current, newRunId) ?? current
      // An edit to a proposal the rerun only replayed is put back, so it can go in the next rerun.
      const refreshed = Object.entries(kept.carried).reduce(
        (content, [name, text]) => rewriteProposal(content, name, text),
        refreshHoldNote(marked, holdNoteInput(landedRun.run, landedRun.layout.panels, heading.chainName)),
      )
      await store.modify(path, refreshed)
      // Named for the run it now shows; a run carried on in place is already that note.
      const renamed = this.pathOf(newRunId)
      if (renamed !== path) {
        if (store.at(renamed)) return { notice: `${said}, but ${renamed} already exists — note not renamed` }
        await store.rename(path, renamed)
      }
      const replaced = kept.replaced.length > 0 ? ` — it wrote ${kept.replaced.join(', ')} again, over your edits` : ''
      return { notice: `${said}${replaced}`, moved: true }
    })
    if (!folded || !('notice' in folded)) return undefined
    this.deps.notify(folded.notice)
    if (!folded.moved) return undefined
    await report.land({ runId: newRunId, chainName: heading.chainName, panels: landedRun.layout.panels })
    const hold = await this.read(newRunId)
    return hold && { hold, forked }
  }
}

/** The engine's frames, told to the watch as progress. */
function progressTo(report: RerunReport): OnEvent {
  const tracker = new RerunProgressTracker()
  return event => {
    const progress = tracker.hear(event)
    if (progress) report.hear(progress)
  }
}

async function fetchRun(engine: EngineClient, runId: string): Promise<FetchedRun> {
  const [run, layout] = await Promise.all([engine.getRun(runId), engine.getLayout(runId)])
  return { run, layout }
}

/** A trailing bare `revise` first; else the Conversation's last entry, when nothing answers it yet. */
function pendingIn(content: string, conversation: ConversationEntry[]): PendingTrigger | undefined {
  const revise = pendingRevise(content)
  if (revise?.reply !== undefined) return { kind: 'revise', turn: { ...revise, reply: revise.reply } }
  const last = conversation.at(-1)
  return last && unanswered(conversation, last.kind)
}

/** The last trigger line of `kind` under Conversation, when nothing answers it yet. */
function unanswered(conversation: ConversationEntry[], kind: TriggerKind): Trigger | undefined {
  const last = conversation.filter(entry => entry.kind === kind).at(-1)
  if (last?.kind === 'chat' && last.reply === undefined) return { kind: 'chat', name: last.name, message: last.message }
  if (last?.kind === 'room' && last.answers.length === 0) return { kind: 'room', question: last.question }
  if (last?.kind === 'quest' && last.runId === undefined) return { kind: 'quest', name: last.name, chain: last.chainName }
  return undefined
}

function appendTrigger(content: string, trigger: Trigger): string {
  if (trigger.kind === 'chat') return appendChatTrigger(content, trigger)
  if (trigger.kind === 'room') return appendRoomTrigger(content, trigger.question)
  return appendSideQuestTrigger(content, { name: trigger.name, chainName: trigger.chain })
}

/** What the human typed into the trigger line. */
function said(trigger: Trigger): string {
  return trigger.kind === 'chat' ? trigger.message : trigger.kind === 'room' ? trigger.question : trigger.chain
}

/** The note keeps each message, question and change on a line of its own; the panel matches what it sent by this. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
