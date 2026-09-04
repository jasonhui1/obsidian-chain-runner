# ADR-0008: A streaming panel renders block by block

Date: 2026-09-04 · Status: accepted

## Context

ADR-0007 stopped every *other* panel re-rendering on a throttled draw, but left
the panel being written whole: its body was emptied and re-rendered whenever the
text changed, which for a streaming hop is every draw — ten a second (#19).

- **Selection was destroyed each tick.** Text could not be highlighted or copied
  out of a panel while it streamed. This is the same class of thing the keyed
  draw fixed for round-row focus.
- **Every post-processor re-ran over the whole panel**, this plugin's own
  source-run header included, along with any embed or image the answer holds.
- **Cost was O(N) a tick with N growing**, so a long hop paid O(N²) across its
  run.

## Decision

**The settled part of a streaming answer is rendered once, and only the part
still being written is re-rendered.** `src/ui/streamBlocks.ts` splits the text
into blocks that join back into it: a boundary is a blank line while not inside a
fence, so a half-written code block is never split, and the last block is always
treated as still growing, since a paragraph or a list can still gain a line. The
blank lines that close a block stay with it and are trimmed before rendering, so
a block is not rendered again for the newline that ended it.

**`src/ui/panelBody.ts` holds one panel's blocks in a `KeyedChildren` keyed by
index** (ADR-0007's mechanism, one level down): a block already rendered keeps
its element, a newly completed one renders once, and only the tail re-renders.
`BoardDeps.renderMarkdown` is called per block rather than per panel, so each
block owns the release of its own render.

**A panel that lands `filled` renders whole, in one pass.** Markdown is not
strictly block-local — a link reference definition or a footnote arriving late
affects an earlier block, and a setext underline retro-changes the paragraph
above it. Rendering block by block does not retro-fix those *while the hop
writes*; the approximation exists only in the in-flight view and heals when the
answer lands.

## Consequences

**A reader can select and copy from a panel while it streams**, which is what the
change is for.

**The block wrappers are `display: contents`**, so the rendered blocks stay
siblings in the box tree and their margins collapse as they did when the whole
answer was one render.

**The split is a pure function with its own node tests.** The boundary rule —
including what a fence protects — is checkable without a DOM, and the invariant
that the blocks join back into the text is what keeps the render faithful.
