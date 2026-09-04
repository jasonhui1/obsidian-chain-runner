# ADR-0011: A resized node cuts its lines again

Date: 2026-09-05 · Status: accepted

## Context

ADR-0009 gave a node a fixed width and cut every line to fit it, because
Excalidraw wraps to the width it is given and a wrapped line would push the ones
under it out through the bottom of the box. The **cut** string is what is written
to the drawing, so the rest of a long chain name was nowhere on the scene.

#21 then turned `autoResize` off, which stopped a drag scaling the type. Between
them, dragging a node wider did nothing at all: the box grew and the words did
not change, because there were no other words to show. A reader who makes a box
bigger is asking for more of the sentence.

## Decision

**A node's lines are cut again when its box changes width.** `reflowEdits` in
`src/ui/chainNode.ts` re-lays the node out at the box's current width and answers
the same `NodeEdit` list the rest of the node's writes use.

**The untruncated words are recovered, not stored twice.** The chain line and the
parameter line are rebuilt from `chainName`, `parameterName` and `parameterValue`
— already stamped on every element, and already the source ADR-0009 re-shapes
from. Only the **moment** has no other record once it is drawn, so
`ChainNodeData` gains `moment`. Keeping a second copy of words that a stamp
already determines would be two sources of truth for one sentence.

A node drawn before this falls back to the words on its own line, so it keeps
working and simply reveals nothing new.

**The type size is put back.** Excalidraw scales `fontSize` when a group is
resized, so a re-cut that did not reset it would compute a layout for one size
and draw at another — the defect #20 shipped. Each line goes back to the size its
role was designed at, which is what makes a bigger box show *more words* rather
than *bigger words*.

**`▶ Run` keeps its own words.** They belong to the run in flight, not the box;
only where the line sits changes. Rewriting them would put `▶ Run` back over a
run still going.

**The trigger is the pointer coming up, not the scene changing.** Every write to
a drawing is a save, and `onSceneChangeHook` with `trackElements` fires on every
frame of a drag — that would be a save per frame. A release is one moment, and
`src/ui/pointerClicks.ts` already watches for it.

**Nothing is written unless a box actually changed width.** Each element records
the width its lines were cut for (`laidOut`), and `reflowEdits` answers an empty
list when the box still matches it. So the release that ends an ordinary click,
or a drag that only moved a node, saves nothing. This guard is what makes it safe
to ask *every* node on the drawing on *every* release, which is simpler than
working out which node a drag belonged to — and it is also what stops a write
loop, since our own re-cut sets `laidOut` to the width it just used.

## Consequences

**A reader cannot resize one line of a node by hand.** A line dragged on its own
is put back at the next release. The node is one thing; its lines are laid out
from the box.

**The box's height is derived, not dragged.** Dragging a corner sets the width;
the height then closes around the lines the new width holds. A node cannot be
made tall and empty.

**The fit is still an estimate.** `GLYPH_WIDTH` guards a runaway line rather than
measuring Excalidraw's font (ADR-0009), so a re-cut line may sit a little short
of the box's edge. Widening still reveals more words, which is what was asked.

**Every pointer release on a drawing reads the scene.** It is a scan and a
comparison per node, and it writes nothing when nothing changed.
