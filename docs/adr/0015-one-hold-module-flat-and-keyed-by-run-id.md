# ADR-0015: One hold module, flat and keyed by run id

Date: 2026-09-18 · Status: accepted

## Context

One click in the directing panel crossed seven modules, the hold note had six
writers, and each palette command was a class of its own with its own
`NOT_A_HOLD_NOTE`. #58 settled the interface of the one module that replaces
them (`Holds`, `src/ui/holds.ts`), designing it three ways first: a minimal
`read`/`act(union)`/`onChange`; a per-run handle from `holds.of(runId)`; and a
flat method per action over the note store and the engine client.

## Decision

**Flat: one method per action the screen offers, every one keyed by the run id
the caller knows.** Proposals are named by their note name; node ids never cross
the seam. The module finds the note wherever a rerun moved it, and every answer
says which run it is under now.

**Every write answers the hold as it now reads.** Rerun, revise and resume
answer a landing: the hold under the run it landed on, whether it forked, and a
resume's canon outcome. `undefined` means nothing was written and a notice has
already said why. Callers draw the answer; nothing re-reads the note after an
action. `onChange` remains for edits made by hand.

**Two dependencies, no new port.** The note store (in-memory adapter in tests)
and the engine client (stub engine in tests, #57), plus the rerun watch as
in-process shared state. The palette shells reach the module through `front()`
and `send(kind)`, so none of them learns the note's grammar.

## Rejected

**One `act` taking a union of actions.** The deepest entry point, but every
action has to answer one type. A resume's canon outcome and a landing's fork or
failure become notices, and the panel draws both today. Typing the answer per
variant would have rebuilt the flat interface inside a switch.

**A handle per run.** `holds.of(runId)` answers an object whose methods take no
run id and whose answers carry the handle to hold next. It saves the panel one
argument and costs an identity: a handle whose run id no longer matches the
hold's reading, interned handles compared by reference, and a rule for when two
handles are one hold. The panel already re-keys itself on a landing; a run id
does that without the second identity.

**A second engine port above `EngineClient`.** It would have made a test
adapter a few canned answers instead of framed events, but it would be one
production adapter over a port that already has test adapters. One adapter is a
hypothetical seam.

## Consequences

**A future action is explicit, not free.** A new conversation trigger costs one
grammar module under `src/run/`, one method here, one board dep and one palette
shell. Nothing generic, nothing hidden.

**`chains` and `runUrl` leave the hold module.** They are the engine's and the
settings', not the hold's; the view gets them from `main.ts`.
