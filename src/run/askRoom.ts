import { appendToConversation, locatedTriggers } from './conversationTrigger'

/**
 * Ask the room: one question sent to every proposer, each answer folded to a
 * few lines and appended under the question — the same Conversation-section
 * loop as `./chat.ts`, addressed to everyone instead of one name.
 */

export interface RoomAnswer {
  name: string
  answer: string
}

const QUESTION_LINE = /^ask the room:\s*(.+)$/i
const MAX_LINES = 3

/** The most recent `ask the room: …` line with no answers under it yet. */
export function pendingRoomQuestion(content: string): string | undefined {
  const questions = locatedTriggers(content, QUESTION_LINE, match => match[1].trim())
  const last = questions[questions.length - 1]
  return last && last.reply === undefined ? last.fields : undefined
}

/** An answer folded to its first `max` non-blank lines. */
function shortAnswer(text: string, max: number): string {
  return text
    .trim()
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
    .slice(0, max)
    .join('\n')
}

/** Every proposer's answer, labeled and folded to at most three lines, one blockquote. */
function answerBlock(answers: RoomAnswer[]): string {
  return answers
    .flatMap(({ name, answer }) => [`**${name}:**`, ...shortAnswer(answer, MAX_LINES).split('\n').filter(line => line !== '')])
    .map(line => `> ${line}`)
    .join('\n')
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
export function roomEntries(content: string): { entry: RoomEntry; at: number }[] {
  return locatedTriggers(content, QUESTION_LINE, match => match[1].trim()).map(({ fields, insertAt, reply }) => ({
    entry: { question: fields, answers: answersIn(reply ?? '') },
    at: insertAt,
  }))
}

/** An answer block read back into who said what. */
function answersIn(block: string): RoomAnswer[] {
  const answers: RoomAnswer[] = []
  for (const line of block.split('\n')) {
    const label = ANSWER_LABEL.exec(line.trim())
    const last = answers.at(-1)
    if (label) answers.push({ name: label[1], answer: '' })
    else if (last && line.trim() !== '') last.answer = last.answer === '' ? line : `${last.answer}\n${line}`
  }
  return answers
}

/** Every proposer's answer appended under the question they answered. Unchanged if that question is gone. */
export function appendRoomAnswers(content: string, message: string, answers: RoomAnswer[]): string {
  const found = locatedTriggers(content, QUESTION_LINE, match => match[1].trim()).find(
    question => question.fields === message && question.reply === undefined,
  )
  if (!found) return content
  return content.slice(0, found.insertAt) + answerBlock(answers) + '\n' + content.slice(found.insertAt)
}
