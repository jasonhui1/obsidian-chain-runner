# ADR-0007: The result view draws by key

Date: 2026-09-04 · Status: accepted

## Context

`RunResultView.draw()` emptied `contentEl` and rebuilt every element on every
draw, and a run draws ten times a second while it streams (#16). Three costs:

- **A CSS transition on run state never fired.** The property did not change on
  an element — the element was replaced.
- **A one-shot keyframe re-fired on every later draw**, so a panel's arrival
  would replay on a round click or a later hop landing. ADR-0006 shipped no
  one-shot motion for exactly this reason.
- **Every panel's markdown was rendered again** on every frame, including the
  panels nothing had happened to.

## Decision

**The view holds its elements by key across draws and updates the ones that
changed.** A panel's key is its node, its loop round and its name, numbered when
a node feeds two ports (`src/ui/panelKeys.ts`) — a panel carries no id, and node
plus round is what stays the same from one frame to the next.
`src/ui/keyed.ts` holds elements by key for one container, and leaves an element
that is already in the right place alone, since moving one drops the focus a
reader has on it.

**The elements move out of the `ItemView` into `src/ui/resultBoard.ts`**, which
draws into a plain element with no Obsidian import: markdown rendering arrives as
a dependency that hands back what releases the render, and the open round is
reported rather than held. The view keeps what is Obsidian's — the leaf, the
markdown renderer, the redraw throttle, and which round is open. The board is
testable against jsdom, which is how the reuse is checked at all.

**A panel that lands filled where a pending one was carries a one-shot arrival
cue**, and a run's status word transitions between its three colours. Both are
reachable now, and only now, because the element survives the change.

The cue fires on the observed edge, not on a panel first drawn filled: opening a
settled run would otherwise flash every panel at once, which says nothing about
what just happened.

## Consequences

**Streaming re-renders only the panel that grew.** A panel whose text has not
changed is left alone, which is the redraw cost the rebuild was paying.

**A round row survives its redraw**, so a reader arrowing through the round list
keeps the focus while the run streams — which the rebuild took away on every
frame.

**Order is the draw's.** Panels are placed in the order the draw uses them, so
the engine's order still decides what is where; nothing about ADR-0001 changes.

**ADR-0006's hold on one-shot motion is lifted**, and its reduced-motion rule
still covers what was added without naming it.

**The directing panel draws by key too (#61).** Its elements are not one list
but a tree of sections, so `src/ui/keyedTree.ts` keys each element by its path
from the root — named where identity matters (a tab, a section, a typing box, an
open edit), counted by kind and place elsewhere — over the same `KeyedChildren`.
A box being typed in, and the proposal editor, are never rebuilt, so the board
puts no focus, cursor or scroll back by hand.
