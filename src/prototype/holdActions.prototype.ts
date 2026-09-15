/**
 * PROTOTYPE (#35) — throwaway. The hold-actions layer the directing panel calls,
 * stubbed: it reads a real hold note once, then edits an in-memory copy with the
 * real note functions. Nothing is saved; engine calls are canned, except Resume,
 * which replays the pitch of the last run the note says it resumed as.
 */

import { appendRoomAnswers, type RoomAnswer } from '../run/askRoom'
import { appendChatReply, markRevised } from '../run/chat'
import { appendDirectionLine, appendResumeLink, directionLine, holdHeading, type DirectionVerb } from '../run/holdNote'
import { extractSection } from '../run/section'
import { appendSideQuestResult } from '../run/sideQuest'

export interface HoldActions {
  direct(verb: DirectionVerb, name: string, second?: string): void
  change(text: string): void
  editProposal(name: string, text: string): void
  rerunDownstream(): Promise<string>
  chat(name: string, message: string): Promise<string>
  revise(name: string): Promise<string>
  askRoom(question: string): Promise<RoomAnswer[]>
  sideQuest(name: string, chainName: string): Promise<string>
  tickCanon(text: string, ticked: boolean): void
  resume(): Promise<{ runId: string; pitch: string }>
}

export type HoldEvent =
  | { kind: 'direction'; line: string }
  | { kind: 'edit'; name: string }
  | { kind: 'rerun'; runId: string; names: string[] }
  | { kind: 'chat'; name: string; message: string; reply?: string; revised?: string }
  | { kind: 'room'; question: string; answers?: RoomAnswer[] }
  | { kind: 'quest'; name: string; chainName: string; result?: string }
  | { kind: 'canon'; text: string; ticked: boolean }
  | { kind: 'resume'; runId?: string; pitch?: string }

export interface Proposal {
  name: string
  text: string
}

export interface CanonLine {
  /** The checklist line minus its marker, attribution included — how the note keys it. */
  text: string
  line: string
  name: string
  ticked: boolean
}

export interface HoldReading {
  runId: string
  chainName: string
  verdict: string
  proposals: Proposal[]
  directions: string[]
  canon: CanonLine[]
  resumed: string[]
}

export class PrototypeHold implements HoldActions {
  readonly events: HoldEvent[] = []
  /** Every hold-action call, in order — what the real layer would have been asked. */
  private readonly edited = new Set<string>()
  private reruns = 0

  constructor(
    public note: string,
    private readonly changed: () => void,
    private readonly fetchPitch: (runId: string) => Promise<string | undefined>,
    readonly calls: string[] = [],
  ) {
    this.events.push(...conversationEvents(note))
  }

  read(): HoldReading {
    return readHold(this.note)
  }

  direct(verb: DirectionVerb, name: string, second?: string): void {
    const line = directionLine(verb, name, second)
    this.call(`direct(${verb}, ${name}${second ? `, ${second}` : ''})`)
    this.note = appendDirectionLine(this.note, line)
    this.events.push({ kind: 'direction', line })
    this.changed()
  }

  change(text: string): void {
    this.call(`change(${JSON.stringify(text)})`)
    this.note = appendDirectionLine(this.note, `CHANGE: ${text}`)
    this.events.push({ kind: 'direction', line: `CHANGE: ${text}` })
    this.changed()
  }

  editProposal(name: string, text: string): void {
    this.call(`editProposal(${name})`)
    this.note = replaceProposal(this.note, name, text)
    this.edited.add(name)
    this.events.push({ kind: 'edit', name })
    this.changed()
  }

  pendingEdits(): string[] {
    return [...this.edited]
  }

  async rerunDownstream(): Promise<string> {
    const names = this.pendingEdits()
    this.call(`rerunDownstream([${names.join(', ')}])`)
    await wait(1500)
    const runId = `${this.read().runId}-rerun${++this.reruns}`
    this.edited.clear()
    this.events.push({ kind: 'rerun', runId, names })
    this.changed()
    return runId
  }

  async chat(name: string, message: string): Promise<string> {
    this.call(`chat(${name}, ${JSON.stringify(message)})`)
    const event: HoldEvent = { kind: 'chat', name, message }
    this.events.push(event)
    this.note = appendConversationLine(this.note, `@${name} ${message}`)
    this.changed()
    await wait(1800)
    const reply = cannedReply(this.proposalText(name), message)
    event.reply = reply
    this.note = appendChatReply(this.note, { name, message }, reply)
    this.changed()
    return reply
  }

  async revise(name: string): Promise<string> {
    this.call(`revise(${name})`)
    const turn = [...this.events].reverse().find(event => event.kind === 'chat' && event.name === name && event.reply)
    await wait(1500)
    const runId = `${this.read().runId}-rerun${++this.reruns}`
    this.note = markRevised(appendConversationLine(this.note, 'revise'), runId)
    if (turn?.kind === 'chat') turn.revised = runId
    this.changed()
    return runId
  }

  async askRoom(question: string): Promise<RoomAnswer[]> {
    this.call(`askRoom(${JSON.stringify(question)})`)
    const event: HoldEvent = { kind: 'room', question }
    this.events.push(event)
    this.note = appendConversationLine(this.note, `ask the room: ${question}`)
    this.changed()
    await wait(2500)
    const answers = this.read().proposals.map(p => ({ name: p.name, answer: cannedReply(p.text, question) }))
    event.answers = answers
    this.note = appendRoomAnswers(this.note, question, answers)
    this.changed()
    return answers
  }

  async sideQuest(name: string, chainName: string): Promise<string> {
    this.call(`sideQuest(${name}, ${chainName})`)
    const event: HoldEvent = { kind: 'quest', name, chainName }
    this.events.push(event)
    this.note = appendConversationLine(this.note, `side quest: @${name} ${chainName}`)
    this.changed()
    await wait(2500)
    const result = `(recorded) ${chainName} took ${name}'s proposal and came back with: ${gist(this.proposalText(name))}`
    event.result = result
    const runId = `quest-${Date.now().toString(36)}`
    this.note = appendSideQuestResult(this.note, { name, chainName }, { runId }, result)
    this.changed()
    return result
  }

  tickCanon(text: string, ticked: boolean): void {
    this.call(`tickCanon(${JSON.stringify(text)}, ${ticked})`)
    const from = `- [${ticked ? ' ' : 'x'}] ${text}`
    const to = `- [${ticked ? 'x' : ' '}] ${text}`
    this.note = this.note.replace(from, to)
    this.events.push({ kind: 'canon', text, ticked })
    this.changed()
  }

  async resume(): Promise<{ runId: string; pitch: string }> {
    this.call('resume()')
    const event: HoldEvent = { kind: 'resume' }
    this.events.push(event)
    this.changed()
    await wait(2000)
    const recorded = this.read().resumed.at(-1)
    const pitch = (recorded && (await this.fetchPitch(recorded))) ?? '(no recorded resume run to replay — the pitch would show here)'
    const runId = recorded ?? 'develop-direction-prototype'
    event.runId = runId
    event.pitch = pitch
    if (!recorded) this.note = appendResumeLink(this.note, { runId })
    this.changed()
    return { runId, pitch }
  }

  private proposalText(name: string): string {
    return this.read().proposals.find(p => p.name === name)?.text ?? ''
  }

  private call(line: string): void {
    this.calls.push(line)
  }
}

export function readHold(note: string): HoldReading {
  const heading = holdHeading(note) ?? { runId: '?', chainName: '?' }
  return {
    ...heading,
    verdict: between(note, /^## Verdict \(.*\)\s*$/m, /^## (Previous verdict|Proposals)\s*$/m),
    proposals: proposals(note),
    directions: directionLines(note),
    canon: canonLines(note),
    resumed: [...section(note, 'Resumed').matchAll(/run (\S+?)\]?\(|run (\S+)$/gm)].map(m => (m[1] ?? m[2]) as string),
  }
}

/** The pitch section of a develop-direction output, or the whole output when it has none. */
export function pitchOf(output: string): string {
  return extractSection(output, 'Greenlight Pitch') || output.trim()
}

function proposals(note: string): Proposal[] {
  const body = between(note, /^## Proposals\s*$/m, /^## Direction\s*$/m)
  return body
    .split(/^### /m)
    .slice(1)
    .map(chunk => {
      const newline = chunk.indexOf('\n')
      const name = chunk.slice(0, newline).trim()
      const text = chunk.slice(newline + 1).replace(/^\s*<details>[\s\S]*?<\/details>/, '').trim()
      return { name, text }
    })
}

function replaceProposal(note: string, name: string, text: string): string {
  const start = note.indexOf(`### ${name}\n`)
  if (start === -1) return note
  const rest = note.slice(start + name.length + 5)
  const end = /^(### |## Direction\s*$)/m.exec(rest)
  const body = end ? rest.slice(0, end.index) : rest
  const fold = /^\s*<details>[\s\S]*?<\/details>\n?/.exec(body)?.[0] ?? '\n'
  return note.slice(0, start + name.length + 5) + fold + '\n' + text.trim() + '\n\n' + rest.slice(body.length)
}

function directionLines(note: string): string[] {
  return section(note, 'Direction')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && line !== 'CANON?' && !/^[A-Z]+:$/.test(line) && !/^- \[[ xX]\]/.test(line))
}

function canonLines(note: string): CanonLine[] {
  return [...note.matchAll(/^- \[([ xX])\] (.+ — (.+))$/gm)].map(m => ({
    ticked: m[1] !== ' ',
    text: m[2],
    line: m[2].slice(0, m[2].lastIndexOf(' — ')),
    name: m[3],
  }))
}

function conversationEvents(note: string): HoldEvent[] {
  const events: HoldEvent[] = []
  const lines = section(note, 'Conversation').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const quote: string[] = []
    while (lines[i + 1]?.startsWith('> ')) quote.push(lines[++i].slice(2))
    const reply = quote.length ? quote.join('\n') : undefined
    let m: RegExpExecArray | null
    if ((m = /^side quest:\s*@(\S+)\s+(\S+)$/i.exec(line))) events.push({ kind: 'quest', name: m[1], chainName: m[2], ...(reply ? { result: reply } : {}) })
    else if ((m = /^ask the room:\s*(.+)$/i.exec(line))) events.push({ kind: 'room', question: m[1], ...(reply ? { answers: [{ name: 'the room', answer: reply }] } : {}) })
    else if ((m = /^@(\S+)\s+(.+)$/.exec(line))) events.push({ kind: 'chat', name: m[1], message: m[2], ...(reply ? { reply } : {}) })
  }
  return events
}

/** The trigger line at the end of Conversation, ahead of any section after it. */
function appendConversationLine(note: string, line: string): string {
  const heading = /^## Conversation\s*$/m.exec(note)
  if (!heading) return `${note.trimEnd()}\n\n## Conversation\n${line}\n`
  const bodyStart = note.indexOf('\n', heading.index) + 1
  const next = /^## /m.exec(note.slice(bodyStart))
  const bodyEnd = next ? bodyStart + next.index : note.length
  const body = note.slice(bodyStart, bodyEnd).trim()
  return `${note.slice(0, bodyStart)}${body ? `${body}\n` : ''}${line}\n\n${note.slice(bodyEnd)}`
}

function section(note: string, name: string): string {
  return between(note, new RegExp(`^## ${name}\\s*$`, 'm'), /^## /m)
}

function between(note: string, start: RegExp, end: RegExp): string {
  const s = start.exec(note)
  if (!s) return ''
  const from = note.indexOf('\n', s.index) + 1
  const e = end.exec(note.slice(from))
  return note.slice(from, e ? from + e.index : note.length).trim()
}

function cannedReply(proposal: string, message: string): string {
  return `(recorded reply) On "${message}": ${gist(proposal) || 'I have nothing on that.'}`
}

/** A proposal's opening words, headings dropped, cut to a reply's length. */
function gist(text: string): string {
  const words = text.replace(/^#+ .*$/gm, '').replace(/\s+/g, ' ').trim()
  return words.length > 220 ? `${words.slice(0, 220)}…` : words
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
