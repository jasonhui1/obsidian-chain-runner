# ADR-0014: The Conversation is written in the note's own grammar

Date: 2026-09-18 · Status: accepted

## Context

A hold note's Conversation section is a dialogue the human writes and the engine
answers: a `@name message` line and the reply quoted under it; `ask the room:`
and `side quest:` lines likewise. The palette commands were written first, for a
human typing those lines into the note and then asking for the answer. So each
has a *reply* grammar: find the pending trigger line, insert the quoted answer
under it.

The directing panel came later (#35–#44) and sends the same message from a text
box, with no line in the note yet. Each panel action got a *turn* grammar of its
own: wait for the engine, then append trigger and answer together as the
Conversation's last entry. Three actions, two writers each, and a chat that fails
from the panel leaves no trace in the note.

#58 asked which grammar survives.

## Decision

**The panel writes the trigger line first, then the hold module answers it —
the palette's grammar.** A message, a question to the room or a side quest sent
from the panel goes into the note as the human's own line would, before the
engine is asked. The reply lands under that line, through the one writer the
palette already uses. `appendChatTurn`, `appendRoomQuestion` and
`appendSideQuest` go.

**A send that fails leaves the line.** The line is what the human said; the
notice says why it was not answered, and "Chat with proposer" from the palette
answers it later. The panel shows it as an entry with no reply.

## Rejected

**The panel's turn grammar for both.** The palette would have had to read the
human's pending line, delete it, and append trigger plus answer as a block. That
rewrites a line the human typed and reorders anything under it. It also keeps
the note blind to a chat in progress.

**Keeping both behind the module.** One writer of the note was the point of the
module (#58, #59); two grammars behind one door is still two grammars, and the
next verb would have to choose again.

## Consequences

**One more write per conversation action from the panel.** The trigger line is
written, then the answer. The note is briefly a note with a pending line, which
is exactly the state the palette was built for.

**The panel draws a pending entry.** A Conversation entry with no reply is a
message waiting on the engine, or one the engine refused. The board already
models an entry's reply as optional.
