# Chain Runner

An Obsidian plugin that runs chains on a maestro-playground engine and lets a
human direct what a run produced, from a sidebar panel or from the note itself.

## Language

### Runs

**Run**:
One execution of a chain on the engine, named by its run id. What it wrote is
its panels, one per node the layout shows.
_Avoid_: job, execution, session

**Panel**:
One node's output as the engine's layout projects it, named as the layout names
it. A proposer panel is one the run converges from; the join panel is the one it
converges on.
_Avoid_: card (that is the drawing's), output note (that is the vault's copy)

**Run of record**:
The run a streaming call turned out to be under: the stream's first `run_start`,
never the id the call was made against.
_Avoid_: new run, result run

**Fork**:
A run of record other than the run a resume, revise or rerun downstream was
called on. The engine decides which run of record the call lands on.
Rerun downstream asks it to fork from edited proposals.
_Avoid_: branch

### Holds

**Hold**:
A run that stopped for a human: it finished, or it waits at a hold node. One
hold per run; a rerun moves the hold on to the run it landed on.
_Avoid_: pause, checkpoint, review

**Candidate**:
One of the choices a waiting hold offers. Picking one is what a resume sends as
`chosen`; leaving all unpicked sends the human's own words instead.
_Avoid_: option, choice

**Hold note**:
The markdown file under `Maestro/holds` that is a hold's record and the human's
place to direct it. Its sections are the note's own grammar; a proposer's words
inside it are not.
_Avoid_: review note, direction note

**Hold module**:
The one owner of a hold: it reads the hold note, calls the engine, writes the
note, and answers what the hold now is. Every surface that acts on a hold is a
caller of it, and nothing else writes a hold note.
_Avoid_: hold actions, hold notes, command class

**Earlier runs**:
The runs a hold was under before its reruns moved it, newest first. A hold is
found by any of them.
_Avoid_: history, ancestors, reran from

### Directing

**Proposal**:
A proposer panel's words as the hold note shows them, named by the panel's name.
Edited, a proposal is what a rerun downstream replays into the run.
_Avoid_: output, answer, draft

**Verdict**:
The join panel's words, shown at the top of a hold that converged. A previous
verdict is the one a rerun replaced, folded under the run it came from.
_Avoid_: result, summary, conclusion

**Direction**:
What the human tells the run to do next, as lines under the note's Direction
heading: a verb given to a proposal, a free-text change, and the canon ticks.
_Avoid_: feedback, instructions, review

**Direction verb**:
KEEP, KILL, PUSH, REDUCE, MUTATE or COMBINE, given to a proposal by name.
COMBINE names a second proposal. CHANGE is free text, never a button.
_Avoid_: action, command, decision

**Canon**:
The lines the human has settled across runs, kept in one canon note and sent
with every call that runs a chain. A proposal offers canon lines; ticking one
locks it in on the next successful resume.
_Avoid_: context, memory, facts

**Conversation**:
The dialogue under the note's Conversation heading: a trigger line the human
writes and the engine's answer quoted under it, in the order written.
_Avoid_: chat log, thread, transcript (that is the engine's, per node)

**Trigger line**:
A Conversation line that asks the engine for something: `@name message` (a
chat), `ask the room: question`, `side quest: @name chain`. Pending until an
answer sits under it.
_Avoid_: prompt, request, command line

**Chat**:
One message to one proposer, answered from that node's own transcript; on an
engine without the endpoint, an approximate answer from a fresh call.
_Avoid_: message, DM, talk

**Ask the room**:
One question to every proposer, answered by each in turn.
_Avoid_: broadcast, poll, group chat

**Side quest**:
One proposal sent through another chain; its result is kept under the trigger
line and changes nothing else.
_Avoid_: detour, sub-run, experiment

**Revise**:
A chat reply made its proposer's own output through the engine's promote, which
reruns to the hold in place or forks.
_Avoid_: promote (the engine's word), accept, apply

**Resume**:
The hold answered and the run carried on, under whichever run of record the
engine names. Ticked canon lines lock in only on a resume that succeeded.
_Avoid_: continue, unpause, submit

**Rerun downstream**:
A new run that replays everything but what the edited proposals feed, then takes
over the hold: the note is refreshed onto it and named after it.
_Avoid_: rerun (alone), retry, re-execute

**Landing**:
A rerun, revise or resume reaching its end with a run of record, and the hold
moving to that run. What the drawing and the panel follow.
_Avoid_: completion, finish, result

### Surfaces

**Directing panel**:
The sidebar view that draws one hold and offers every direction on it. It draws
what the hold module answers; it never reads the note itself.
_Avoid_: directing view, board, sidebar

**Palette command**:
One of the plugin's commands in Obsidian's command palette that acts on the hold
note in front of the reader: Direct this run, Resume this hold, Rerun downstream,
Chat with proposer, Ask the room, Side quest.
_Avoid_: command class, action

**Direction buttons**:
The verb buttons drawn under each proposal heading in a rendered hold note, a
shortcut for typing the same line under Direction.
_Avoid_: verb bar, proposal buttons
