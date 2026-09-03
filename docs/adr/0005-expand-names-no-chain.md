# ADR-0005: Expand names no chain, and its proposals are output notes

Date: 2026-09-03 · Status: accepted

## Context

#12 asks for Expand: a block on a drawing, a chain asked for branches off it, and
the answers back as greyed, dashed cards the reader keeps or drops. The ticket
gated itself on two questions and refused to be started until they were answered.

**Which chain runs?** The feature reads as though there is an "expand" chain. The
workspace has fourteen and none of them is one, and #1 puts chain content design
out of scope for this series — so the obvious route, writing one, was closed.
Hardcoding an existing slug was the other route: `five-personas` fans to six,
`write-the-opposite` to two. Both would bake one workspace's vocabulary into the
plugin, and neither would mean anything in a vault whose engine has different
chains.

**Are proposals text elements or output notes?** A text element is lighter: no
folder, no frontmatter, and dropping one is a delete with nothing behind it. It
also sits outside every convention this repo has ratified — the run folder and
provenance keys (#7), filling in place (ADR-0003), the resolved run link
(ADR-0004). An accepted proposal is meant to *become* accepted material, and
accepted material here is an output note.

## Decision

**Expand asks the reader which chain, and its proposals are ordinary output
notes drawn as proposals.**

1. The command reads the selected block, opens the chain picker already used to
   place a node, and runs the pick seeded from that block. No chain is named in
   this repo, so nothing has to be written on the engine before Expand works, and
   a vault with different chains gets Expand for free.
2. Each declared output becomes an output note under the run's folder, filled in
   place as the engine streams, and shown in an embeddable — the same path a
   chain node's outputs take.
3. What makes it a *proposal* is style and a stamp, not a different kind of
   thing: grey, dashed, `customData.chainRunnerProposal`, and a `✓ Keep` /
   `✕ Drop` pair beneath it.
4. Keeping one restores the drawing's own ink, drops the labels, and clears the
   stamp — after which nothing on the drawing says it was ever a proposal.
   Dropping one takes its elements off the drawing and trashes its note.

## Keeping and dropping take two routes

`docs/spike-ea.md` (Q1) settled that following a link on a drawing needs
Ctrl/Cmd+Click, and named the choice this leaves: *"Either accept that and label
it, or drive runs from a command / context menu."* #12 asks for accept and
dismiss to be one click each, so the labels alone would not meet it.

Both routes are built. The `✓ Keep` / `✕ Drop` labels sit on the card, where the
decision is; the same two decisions are in the command palette, acting on the
selected proposal, where no modifier key is needed. The labels are the
affordance; the commands are the one-action path.

## Consequences

A chain the reader picks is not written to propose branches, so what comes back
is the chain's own outputs rather than variations on a theme. That is the honest
consequence of leaving chain content out of scope; an `expand` chain later
changes nothing here, since it will appear in the same picker.

Dropping a proposal trashes a real file. It goes to the trash rather than being
erased, so the reader's own deletion setting decides how final that is, and the
drawing is rid of the card before the note goes — the other order would leave an
embeddable pointing at nothing.

The proposal stamp lives under its own `customData` key. A chain node's stamp and
a proposal's are never read for one another, and an accepted proposal keeps no
key at all.
