import { roomEntries, type RoomAnswer } from './askRoom'
import { chatEntries } from './chat'

/** A hold note's Conversation read back as plain data: chats and questions to the room, in the order they were written. */

export type ConversationEntry =
  | { kind: 'chat'; name: string; message: string; reply?: string; revisedAs?: string }
  | { kind: 'room'; question: string; answers: RoomAnswer[] }

/** `proposers` are the hold's proposal names, which tell one answer to the room from the next. */
export function readConversation(content: string, proposers: string[]): ConversationEntry[] {
  return [
    ...chatEntries(content).map(({ entry, at }) => ({ entry: { kind: 'chat' as const, ...entry }, at })),
    ...roomEntries(content, proposers).map(({ entry, at }) => ({ entry: { kind: 'room' as const, ...entry }, at })),
  ]
    .sort((a, b) => a.at - b.at)
    .map(({ entry }) => entry)
}
