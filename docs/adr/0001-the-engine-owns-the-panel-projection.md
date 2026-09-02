# ADR-0001: The engine owns the panel projection

Date: 2026-09-02 · Status: accepted

## Context

A run's result is drawn as panels: how many, what text in each, which one is
emphasised, which are still waiting. Something has to decide that from the
chain's declared `view` and `outputs` plus the outputs each hop produced.

maestro-playground already decides it, in `lib/layoutModel.ts` (its ADR-0015 and
ADR-0016). It exposed the answer at `GET /api/runs/:id/layout`, which reads the
run's metadata off disk — so it answers only for a run that has finished.

The quick path (#4) draws panels while the run is still going: they exist before
the first hop and fill in as each one lands. So that route could not be called,
and the first implementation ported `buildLayoutModel` into this repo.

A ported rule diverges silently. Change what separates `empty` from `errored` in
the engine and the plugin keeps drawing the old rule — no error, no failing test
on either side, just two windows disagreeing about the same run. The port was in
fact correct (all 24 of the engine's cases were mirrored and passed), but nothing
kept it that way except attention.

## Decision

**The engine projects the panels. This repo draws them and adds nothing to what
a panel means.**

`POST /api/run` streams a `layout` frame — one before the first hop, one after
every `agent_done` — carrying the engine's own projection, every panel tagged
with the `node` it binds to (maestro-playground ADR-0017). `src/run/layout.ts`,
the port, is deleted.

`src/run/panels.ts` holds only the two things the engine has no reason to know
about:

- **Live tokens**, laid over a panel that is still `pending`, keyed by `node`.
- **The trace fallback**, for a chain that declares no layout — the engine sends
  `{ kind: 'undeclared', panels: [] }` as the cue.

Support is **feature-detected**, not version-pinned: `GET /api/workspace` reports
`capabilities`, and the quick path refuses to run without `runLayoutFrames`
rather than drawing a rule it no longer owns.

## Consequences

**For every later UI ticket.** A surface that shows a run's results — the
Excalidraw drawing in #5 onwards — renders the frames it is sent. It does not
compute panels, and it does not need its own copy of anything. Adding the third
and fourth surface costs what the second one cost.

**A change to what a panel *is* is an engine change.** A new layout kind, a
different line between `empty` and `errored`, a new emphasis: raise it against
maestro-playground, not here. It arrives through the stream with no change in
this repo.

**A version floor, deliberately loud.** The plugin refuses an engine that does
not stream frames, and says what is missing. New engine behaviour this plugin
depends on should get a `capabilities` flag, because that is the only handshake
between two separately shipped things.

**The drift is smaller, not gone.** Both sides must still agree on the *shape* of
a frame, and no test spans the two repos. If `node` were renamed, the token
overlay would stop working silently; if the `state` values changed, a panel would
lose its notice. That is a narrower and coarser risk than two copies of a
semantic rule going quietly out of step — but it is not zero, and it is the thing
to check first when panels look wrong.

**Bandwidth is traded away.** Every frame carries the full text of every panel,
re-sent per hop. A ten-hop chain sends its result ten times. It is localhost, and
the trade buys one rule instead of two.
