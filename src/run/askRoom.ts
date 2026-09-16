import { appendToConversation, locatedTriggers, quoted, type LocatedTrigger } from './conversationTrigger'

/**
 * Ask the room: one question sent to every proposer, each answer appended whole
 * under the question — the same Conversation-section loop as `./chat.ts`,
 * addressed to everyone instead of one name.
 */

export interface RoomAnswer {
  name: string
  answer: string
}

const QUESTION_LINE = /^ask the room:\s*(.+)$/i

function locatedQuestions(content: string): LocatedTrigger<string>[] {
  return locatedTriggers(content, QUESTION_LINE, match => match[1].trim())
}

/** The most recent `ask the room: …` line with no answers under it yet. */
export function pendingRoomQuestion(content: string): string | undefined {
  const questions = locatedQuestions(content)
  const last = questions[questions.length - 1]
  return last && last.reply === undefined ? last.fields : undefined
}

/** Every proposer's answer, whole and labeled, one blockquote. */
function answerBlock(answers: RoomAnswer[]): string {
  return answers.map(({ name, answer }) => quoted(`**${name}:**\n${answer.trim()}`)).join('\n')
}

/** A question and every answer to it written together, as the Conversation's last entry. */
export function appendRoomQuestion(content: string, question: string, answers: RoomAnswer[]): string {
  return appendToConversation(content, `ask the room: ${question}\n${answerBlock(answers)}`)
}

/** A question to the room as the Conversation reads back. */
export interface RoomEntry {
  question: string
  answers: RoomAnswer[]
}

const ANSWER_LABEL = /^\*\*(.+?):\*\*$/

/** Every question to the room under Conversation, in order, each with where it sits in the note. */
export function roomEntries(content: string, proposers: string[]): { entry: RoomEntry; at: number }[] {
  return locatedQuestions(content).map(({ fields, insertAt, reply }) => ({
    entry: { question: fields, answers: answersIn(reply ?? '', proposers) },
    at: insertAt,
  }))
}

/** An answer block read back into who said what; only a proposer's name starts a new answer, so a bold line inside one stays in it. */
function answersIn(block: string, proposers: string[]): RoomAnswer[] {
  const answers: { name: string; lines: string[] }[] = []
  for (const line of block.split('\n')) {
    const name = ANSWER_LABEL.exec(line.trim())?.[1]
    if (name !== undefined && proposers.includes(name)) answers.push({ name, lines: [] })
    else answers.at(-1)?.lines.push(line)
  }
  return answers.map(({ name, lines }) => ({ name, answer: lines.join('\n').trim() }))
}

/** Every proposer's answer appended under the question they answered. Unchanged if that question is gone. */
export function appendRoomAnswers(content: string, message: string, answers: RoomAnswer[]): string {
  const found = locatedQuestions(content).find(
    question => question.fields === message && question.reply === undefined,
  )
  if (!found) return content
  return content.slice(0, found.insertAt) + answerBlock(answers) + '\n' + content.slice(found.insertAt)
}
