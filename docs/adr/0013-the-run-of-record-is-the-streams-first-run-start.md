# ADR-0013: The run of record is the stream's first `run_start`

Date: 2026-09-17 · Status: accepted

## Context

Two of the engine's calls do not always carry on the run they were made against.
Resume on a hold that is already answered starts a new run; promote past an
answered hold, or on a run that has finished, does the same. The engine calls
this a fork, and it decides — the plugin never asks for one.

Both calls answer with the ordinary run stream, and `run_start { runId }` is
always its first event. A fork is that id differing from the id the call posted
to. Nothing else in the stream marks one.

Before this, each caller read the run id its own way. `drainRun` kept whichever
id the last event carried; `rerunAndRefresh` worked a fork out by comparing that
id with the note's heading. Two calls that fork, two places reading the same
event, and a third — `ui/resume.ts` — that read the id but never noticed the
difference, so a forked resume refreshed a note the fork did not have and left
the answered hold on screen still offering its candidates.

## Decision

**One reader: `src/run/fork.ts`.** `underRunOfRecord(calledOn, stream)` wraps a
run stream, keeps the first `run_start`'s id, and answers a `ForkedRun` — the
outcome under that id, plus `forked`. Both calls that can fork go through it:
`runResume` and `runPromote`. A fresh run carries nothing on, so
`rerunAndRefresh` says `forked: false` outright rather than asking; the hold
note's vault half then takes one kind of answer whatever fired the run.

**The first `run_start` wins, not the last id seen.** A stream names its run
before it does anything, and a later event naming another run would be the
engine contradicting itself. Taking the first makes the run of record fixed for
the rest of the stream, which is what the surfaces that follow along need.

**A fork is followed, not merged.** The note and the panel move to the fork: the
hold note is renamed to the fork's path where the call already owned one
(promote), or the fork's note is opened where it did not (resume). The run
forked from keeps a `## Resumed` line saying where the live run went, and is
refreshed so it no longer offers a hold the engine has answered — a fork that
failed is still a fork, and that hold is answered either way.

## Rejected

**`drainRun` keeping the first id for everyone.** It would have made every
caller fork-correct for free, and it is a change of meaning for `RunOutcome.runId`
that a plain launch, a side quest and ask-the-room would all have inherited
without asking for it. A separate reader says which calls can fork.

**Comparing run ids at the vault half.** `newRunId !== heading.runId` is the
right answer for a hold note and the wrong question everywhere else — a fresh
rerun always differs, and a resume has no heading to compare against. Whether
the engine forked is the stream's fact, so the stream reports it.

## Consequences

**`runResume` and `runPromote` answer a `ForkedRun`, not a `StreamedRun`.** A
caller that wants only the id still reads `outcome.runId`; one that draws
anything about a fork reads `forked` rather than guessing.

**Resume needs somewhere to send the reader.** `ResumeDeps` gained `openFork`,
wired to the directing panel's `openHold`, which writes the fork's note when it
has none and shows it. That one call moves both surfaces: the panel's `show`
already re-points it at the run it is given, so nothing else follows a resume.

**A fork says so in words.** The `## Resumed` line reads `forked as run X — the
live run is there now`, and the notice reads `Resumed — forked as run X`. The
run forked from is no longer live and the note says which run is.
