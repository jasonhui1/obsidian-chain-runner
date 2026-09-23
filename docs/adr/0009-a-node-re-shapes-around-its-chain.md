# ADR-0009: A node re-shapes around its chain, and keeps its box

Date: 2026-09-04 · Status: accepted

## Context

Until #20 the chain a node ran was fixed when the node was placed. Wanting a
different chain meant a whole new node — and a new node has nothing bound into
it, so every arrow had to be redrawn as well.

Making the chain line a dropdown, the way `audience ▾ <value>` already is, is
not a text rewrite. A chain owns two of the node's other lines:

- the grey **moment** is the chain's, and a chain may state none;
- the **parameter** line is the chain's declared dropdown, and a chain may
  declare none, or one with different options.

So lines appear, disappear and move, and the box changes height. The obvious
implementation — delete the node and place a fresh one — is what the drawing
cannot afford.

## Decision

**The node is re-shaped against a freshly built one, matched by role, and the
box is kept.** `chainEdits` in `src/ui/chainNode.ts` builds what the new chain's
node would be, pairs each line with the existing element of the same role, and
answers three lists: elements to rewrite, lines to draw, lines to remove.

The box is kept because **arrows bind to element ids**. Deleting the box would
drop every input bound into the node, which is the whole of what a node reads
(#9) — the reader would be changing one dropdown and silently losing their
wiring. Only the lines inside the box are added and removed.

**A line drawn onto an existing node claims the node's `groupIds` and `frameId`
off the box.** Excalidraw works those out only for a *drop*; a scripted element
that does not claim them is loose on the scene, and the node stops moving and
copying as one thing.

**The chain-owned lines keep their left edge; only `y` and the box's height
change.** Since #71, the right-aligned `run` label sits just before the editable
count box at the box's right edge. Reshaping and reflow update the `x` positions
of that pair to keep them aligned, while leaving the count's words alone. The
`run` line's words still belong to the run, not the chain.

## Consequences

**The parameter value does not survive the change.** A different chain declares a
different dropdown, so the old value would be an option of a chain that is gone.
The new chain's own dropdown is asked for at the pick, as it is when a node is
placed.

**`ChainNodeRole` keeps `title`**, the name the chain line had before it was
clickable. It is read as `chain`, never written, so a node already on a drawing
still runs and still re-shapes — but its line carries no link, so it is not
clickable until it is replaced.

**A node placed with no chain at all is a shape the builder has to hold**, which
is what the toolbar button drops: `⛓ pick a chain ▾` and `▶ Run`, and a run that
says which line to click.
