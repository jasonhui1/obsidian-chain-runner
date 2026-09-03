# ADR-0003: A run's outputs fill in place

Date: 2026-09-03 · Status: accepted · Supersedes ADR-0002

## Context

ADR-0002 held the outputs back until `run_complete`, because the output-note
convention files a run at `<folder>/<runId>/<output>.md` and the engine only
reported its id at the end. That ADR named the change that would reopen it:

> It becomes streaming the day the engine names a run at its start.

maestro-playground now does, and the id was being minted before the stream
opened all along — it simply wasn't reported until the end. Three capability
flags describe the contract:

- **`runStartEvent`** — a `run_start` event carrying `runId`, before the first
  layout frame.
- **`runLayoutFrames`** — unchanged, from ADR-0001.
- **`runFailureFrame`** — a failed run streams one last layout frame, every panel
  still `pending` moved to `errored` with the run's message on `panel.error`,
  and only then the `error` event.

The third flag is the one that was not obvious. Without it, a run that dies
before any hop leaves the plugin holding a pre-hop frame in which every panel is
`pending` for ever, and the only signal that they are dead is the out-of-band
`error` event. Acting on that would be the plugin deciding what a pending panel
means — precisely what ADR-0001 gives to the engine. Waiting for the first
`agent_done` instead has the same defect in a different place.

A fourth question was settled and rejected: whether a run that died before any
hop should get a panel state of its own (`aborted`) rather than reusing
`errored`. It does not. ADR-0001 names a changed set of `state` values as the
standing drift risk between the two repos — a value this plugin doesn't know
degrades to a panel with no notice, silently. The distinction is not one the
plugin can act on, and it survives anyway in the message: the run that never
started is exactly the run where every panel carries the same one. The revisit
trigger is logged as maestro-playground #77.

## Decision

**The outputs are opened, placed and filled while the run is going.**

1. `run_start` names the run.
2. The first layout frame names the panels. Every declared output is created as
   an empty note with its provenance frontmatter, and placed inside the frame as
   an embeddable — before any of them has anything to say.
3. Each note is rewritten as its panel fills, **a line at a time**, which is the
   spike's own recommended cadence (`docs/spike-ea.md`, Q2: an embeddable
   repaints per write, not per character). A hop's unfinished last line is
   flushed when the panel changes state.
4. The final frame — whether the run completed or failed — is written to every
   note as-is.

The drawing path refuses an engine missing any of the three flags, and says
which is missing, rather than falling back to a second placement strategy.

## Consequences

**Placement stays initial-only.** The frame and coordinates are computed once,
from the first frame that names the panels, and never recomputed. Later frames
change what a panel holds, never where it is — so a reader who has dragged an
output somewhere better keeps it, which was the point of the manual criterion in
#9.

**A run that dies before a hop leaves notes, not blanks.** The notes exist by
then; the failure frame gives each one an `errored` state and the reason, and the
note body becomes that reason, quoted. A file holding nothing but frontmatter
would tell a reader who found it later nothing at all. The engine's run
directory records the same failure with `status: "error"`, so neither side has a
blank.

**"Engine offline → nothing written" still holds, and is now exactly the
request-level case.** A rejected request returns a plain 4xx with no stream, so
no `run_start`, so nothing is ever created. That is the whole of the
nothing-written path, which is a sharper line than ADR-0002 could draw.

**One rule, still the engine's.** The plugin gained no new inference. It draws
the frames it is sent, writes what the panels say, and stops. What changed is
when it is sent enough to start.
