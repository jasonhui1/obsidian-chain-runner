# ADR-0016: A hold on the drawing is a fork point

Date: 2026-09-23 · Amended: 2026-09-24 · Status: accepted

## Context

A chain node whose run stops at a hold draws a frame with a card for every
panel the layout declares. The panels after the hold have not run, so their
cards stay blank, and nothing on the drawing says why. The node's `▶ Run` line
says `✓ done`. The hold's candidates are only in the directing panel and the
hold note.

Answering the hold does not show the reader the other possibilities either.
The engine keeps every answer: the first resume carries the run on in place,
and every later resume of the same hold forks a new run whose
`branchedFromRunId` names the source and `branchedFromNode` names the hold
(maestro-playground `CONTEXT.md`, "Fork"). `GET /api/runs?branchedFromRunId=`
lists them. The drawing keeps only one of them, because a landing moves the
frame's cards on to the run it landed on (`RerunOnDrawing`, `Holds.fork`
reporting `report.land`). A second answer replaces what the first one produced.

## Decision

**A waiting hold is drawn as a hold column.** Its prompt comes first, then one
card per candidate, one under another, then a card for the reader's own words.
A list of candidates reads top to bottom, and each pick row can then sit beside
the candidate it came from. Panels the run has not reached are not drawn.
Panels before the hold stay in a row ahead of the column. The node's `▶ Run`
line says the run is waiting for the reader, not `✓ done`.

**Short text is shown whole on the drawing; long text is read in the panel.**
A candidate card shows the candidate's whole text, wrapped in its box, because
the reader picks on the whole idea. An output card is a small preview, about
320×160: its first lines and its length (`42 lines`). A click opens it on its
tab in the directing panel, which shows it whole. The drawing is for seeing
everything at once and comparing it; the panel is for reading one thing.

**A candidate's slot is reserved at its full height from the start.** A slot is
as tall as the taller of the candidate's text and one output card, so a pick
never moves the candidates below it. The empty space beside an unpicked
candidate is where its pick row will go.

**Each answered candidate grows a pick row to its right.** A pick row holds the
panels after the hold, in one row and one card tall, top-aligned with the
candidate that produced it. The step names are written once above the rows,
because every pick row runs the same recorded graph. Reading down a column
compares one step across candidates.

**A continuation from the hold column adds a row. It never re-points one.** Each
pick starts a separate run and gets its own row and `✎ Direct`. The source hold
stays open so other candidates can start immediately. The run of record is the
stream's first `run_start` (ADR-0013).

**A pick on the drawing is the panel's Resume.** It ticks the candidate in the
hold note and resumes through the hold module, so the Direction lines and the
ticked canon go with it exactly as they do from the panel.

**A row is named by the candidate it came from, never by its run id.** A run id
means nothing to a reader. It stays in the stamps, in tooltips and in the
panel's `⋯` menu.

**The rows come from the engine.** The source run's hold record says which
candidate its in-place answer chose (`chosen` or `custom`). Each fork's
`branchedFromNode` and its own copy of the hold record say which one it chose.
Stamps on the drawing say where a row is, not what it means. A fork started
from the directing panel or the engine's site can therefore be drawn too.

**A hold inside a pick row repeats the pattern** at the end of that row, and
the rows below it move down to make room.

**A candidate picked more than once stacks its rows beneath its first**, for
example when it is continued again with another model. Its slot grows by a row,
and the slots below move down, the same way they do for a nested hold. This is
the one case where a pick moves the candidates below it.

**Every run of a node that runs more than once gets its own hold column**, in
its own frame, stacked as the frames are now. Picks in different runs may go at
the same time.

**The gestures are ADR-0010's.** A single click on a candidate opens it in the
directing panel. A double-click on its `▶ Continue` answers the hold, the way a
double-click on `▶ Run` starts a run, because both spend tokens and cannot be
taken back.

**Frames already on a drawing are left as they are.** Only runs started after
this change are drawn this way.

## Rejected

**Candidates side by side, with pick rows below them.** This was the first
sketch. Candidates in a row read less easily than a list, and it puts unrelated
rows between a candidate and its outputs.

**A candidate cut to its title and one line.** It saves height, but the reader
picks on the whole idea and would have to open each one to read it.

**Outputs shown whole on the drawing.** An output is many times longer than a
candidate. Whole, every row would be as tall as its longest output, and the
drawing would stop being something to scan.

**Growing a slot only when its candidate is picked.** It would start the column
shorter, but every pick would move the candidates below it, and moving elements
is a write to the drawing that a reserved slot never needs.

**Re-pointing the frame on each pick, as a landing does now.** It removes the
earlier answer's outputs from the drawing, which is what a reader branching
wants to keep.

**Candidates only in the directing panel.** The panel shows one hold at a time
and hides the drawing. The choice is the moment the reader wants to see the
other possibilities.

**A note per candidate, embedded.** It would render markdown and refresh itself
on a reroll. It also writes a note per candidate per revision into the vault.
Candidates start as text bound into a box; revisit this if their words need
markdown.

## Consequences

**The hold note already follows this; the drawing does not.** `Holds.fork`
writes a fork a hold note of its own and refreshes the origin's. What changes is
the drawing: a landing started from a hold column adds a pick row instead of
calling `followRerun`. Rerun downstream and revise, started from the directing
panel, still move the frame on.

**An in-place resume must now fill the drawing.** Today only a fork and a fold
report a landing. A resume that carries the run on in place reports none, so no
output notes are written for the panels after the hold.

**Rows cannot be found by their titles.** `renameRunFrame` finds a frame by the
run id at the end of its title. A pick row's title is its candidate, so a row is
found by its stamp.

**Reroll stays before the first pick.** The engine rerolls only an open hold,
so the column's `⟳ Reroll` goes away once a candidate is answered. Rerolling an
answered hold needs an engine change (maestro-playground #147).

**Different candidates can continue together.** Each drawing pick forks from
the waiting hold, including the first. Live notes and drawing writes stay
separate by picked run, while writes to the shared source note and drawing are
serialized. A repeated double-click on the same candidate starts only one run.

**A candidate card is stamped with its run id, hold node id, heading and
candidate revision.** A pick from a set a reroll replaced is refused by the
engine rather than landing on the wrong candidate.

**The directing panel reads whole and moves between picks.** Its proposal text
is no longer clamped, its header names the pick rather than the run id, and a
switcher in the header moves to the same tab in another pick of the same hold.
