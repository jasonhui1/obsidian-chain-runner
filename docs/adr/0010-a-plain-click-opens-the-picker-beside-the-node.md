# ADR-0010: A plain click opens the picker, beside the node

Date: 2026-09-04 · Status: accepted

## Context

#20 made a node's chain changeable on the drawing, but only through
`onLinkClickHook` — and following a link in Excalidraw needs Ctrl/Cmd+click. A
reader who clicks the chain line gets a selected line and nothing else. The
picker that does open is an Obsidian modal, so it lands centre-screen, away from
the node it is about to re-shape.

`docs/agents/excalidraw.md` recorded "only a link fires the hook". Reading
Excalidraw 2.26.4's `main.js` showed that to be a fact about `onLinkClickHook`
alone. `onSceneChangeHook` takes an `appStateKeys` filter, and filtering on
`selectedElementIds` makes an unmodified click reachable.

## Decision

**A plain click is a change of selection, and the policy that reads one is
pure.** `src/ui/selectionClick.ts` turns a run of selections into clicks:
exactly one element, and different from the last selection seen. That is what
keeps a rubber-band, a Select All and a redraw from opening anything.
`registerSelectionHook` in `src/ui/excalidraw.ts` only reaches the hook and looks
the element up by id; it decides nothing, so it stays inside the one untested
seam.

**Selection is not enough: nothing opens until the press ends.** Excalidraw
reports the selection the moment the pointer goes down, which is too early to
know what the reader is doing — a **drag** of the node begins with exactly the
same event, and a **keyboard** selection has no press behind it at all. So
`src/ui/pointerClicks.ts` holds the press and answers the waiting picker only
once it settles: the press's own position when the pointer comes up near where
it went down and soon enough, and nothing when it travelled, was held, was
cancelled, or never existed. One mechanism is both the gate and the anchor —
a picker opens exactly when there is a place to open it.

**The click reaches the two lines that open a picker, and not `▶ Run`.**
Selecting a node is not asking to run it, and a run cannot be taken back — where
a picker can be dismissed. Ctrl/Cmd+click and `Run chain on this note` still
start a run, so nothing is lost.

**Both routes stay.** The link hook, the commands and the toolbar button are
untouched; this adds a route.

**The picker opens beside the press, not beside the node.**
`src/ui/panelSpot.ts` puts the panel below and right of the press that settled,
flipping and clamping so it never leaves the window.

The alternative was to anchor to the node's own box. That needs scene-to-viewport
coordinates, which live in Excalidraw's `excalidrawLib` rather than on
`ExcalidrawAutomate`, and it would have to be redone for zoom, scroll and a
drawing embedded in a note. The press is where the reader's attention already is,
and it costs no Excalidraw internals.

**The palette's own picker stays centre-screen.** The press that opened it was on
the command palette, so anchoring there would put the picker beside something
irrelevant.

**The panel's size is declared, not measured.** A suggest modal has no rows until
the reader types, so measuring it as it opens reads a height it is about to grow
past. `PANEL` in `src/ui/panelSpot.ts` is what the spot is computed from and what
`anchorModal` writes onto the element, so the two cannot drift.

**`autoResize` is off on a node's text lines.** Dragging a node's handles used to
scale the font, because that is Excalidraw's default for a text element. Off,
with the width the line was laid out at, the type size holds. It does not reveal
more of a long chain name — the line is truncated when the node is built — but a
node keeps reading at the size the rest of the drawing was arranged around.

## Consequences

**Clicking a line that is already selected does nothing.** Excalidraw reports no
change, so the hook does not fire and no policy could see it. Changing the same
node's chain twice means clicking away and back, or Ctrl/Cmd+click. Deselecting
from here is not available either: `selectElementsInView` returns early on an
empty list.

**Selecting a node from the keyboard opens nothing.** There is no press to
settle, so there is no click. The two lines stay reachable by Ctrl/Cmd+click and
by the palette.

**The picker opens on pointer-up, not pointer-down.** A press that never
releases — the window taking the pointer away without a `pointercancel`, say —
leaves the picker unopened rather than opening it late. Both routes back to the
line still work.

**The hook is shared, and the last installer wins.** As with `onLinkClickHook`,
the previous hook is chained and put back on unload, and its `appStateKeys` are
merged with ours so chaining never narrows what it asked for.

**Every scene change now runs our callback.** It does an id comparison and a
lookup, on a hook Excalidraw already fires for anything holding one.

**A proposal's decisions are still Ctrl/Cmd+click.** Keep and drop write to the
vault, and this ADR's reasoning about `▶ Run` applies to them the same way.
