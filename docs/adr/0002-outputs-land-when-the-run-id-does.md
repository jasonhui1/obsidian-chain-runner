# ADR-0002: A run's outputs land when its id does

Date: 2026-09-03 · Status: superseded by [ADR-0003](0003-outputs-fill-in-place.md)

> **Superseded on the same day it was written.** The engine now reports its run
> id before the first hop, which is the exact change the last section below names
> as the one that would reopen this. The reasoning is kept because it is why the
> engine changed, and because the constraint it describes — an output note is
> filed under a run id — still holds.

## Context

The EA spike (`docs/spike-ea.md`, Q2) established that an embeddable showing a
vault note re-renders live while the drawing is open, and recommended for #9:

> **Stream into embeddables.** The run can create each output note empty, place
> its embeddable immediately, and append to the note as the engine's SSE stream
> arrives. The user watches outputs fill in place.

That recommendation is about Excalidraw, and it is correct about Excalidraw. It
collides with a convention decided elsewhere.

The output-note convention (#7) files a kept panel at
`<folder>/<runId>/<output>.md`, with `run:` in its frontmatter. The run id is
the engine's, and the engine reports it in `run_complete` — the last event of
the stream. Before that event there is no folder to create the note in and no
provenance to stamp on it.

Three ways out were available:

1. **Write under a provisional name and rename on `run_complete`.** Every
   embeddable would then point at a path that no longer exists; Excalidraw
   stores the reference in the scene, and Obsidian's link-update machinery does
   not reach inside a `compressed-json` scene. The drawing would end the run
   holding four dead embeddables.
2. **Invent our own id for the folder.** The plugin would then hold a second
   name for a run the engine already named — which is the thing #1's rules
   forbid: _"runs are recorded by the engine; the plugin stores run references,
   never a second run store."_
3. **Ask the engine to report its id at the start of the stream.** The right
   answer, and not this repo's to make.

## Decision

**Nothing is written until the run completes.** The node reports progress on its
own `▶ Run` line — `⏳ 2/5`, counted from the engine's layout frames — and the
frame, the notes and the embeddables are placed in one go when `run_complete`
arrives with the id they are all filed under.

A run that never reports an id writes nothing at all, and says so.

## Consequences

**The reader watches the node, not the outputs.** A long run shows a count that
climbs and then a frame that appears whole. That is less than the spike offered
and more than nothing; the panel-by-panel view is a keystroke away in the quick
path (#4), which streams because it holds its panels in memory and files nothing.

**The spike's finding is not wasted.** Q2 is what makes the placed embeddables
live: an output note edited afterwards — by the reader, or by a later ticket —
redraws in place without the drawing being touched. Streaming during the run is
the only part given up.

**It becomes streaming the day the engine names a run at its start.** The change
is small and local: the id is what the placement waits for, not the outputs.
Raise it against maestro-playground as a `run_start` event or an id on the
existing first frame, alongside a `capabilities` flag (ADR-0001), and this
decision can be revisited without anything else moving.
