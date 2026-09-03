# Spike: ExcalidrawAutomate integration — findings

Status: **complete.** All four questions answered by observation in Obsidian.
Repros: `docs/spike-ea/` (throwaway, nothing here ships).

Excalidraw plugin version tested: **2.26.4** (Obsidian, Windows 11)
`verifyMinimumPluginVersion` value to require: **`"2.0.0"`**

Rationale: every EA call the plugin needs predates 2.0 — embeddables appear in release
notes from 1.9.9, and `onLinkClickHook` / `setView("active")` / `addElementsToView` are
older still. 2.0.0 is a round floor that excludes the 1.x line without excluding any
user on a current release. Verified working on 2.26.4; **not** regression-tested against
2.0.0 itself, so raise the floor rather than lower it if a 2.x user reports trouble.

Legend: **[obs]** observed in Obsidian · **[src]** derived from plugin source/docs, not observed.

---

## Q1 — Does `onLinkClickHook` fire for a link inside a boxed text element, and does returning `false` suppress the default open?

**Answer: YES to both. [obs]**

**Key finding [obs]:** the hook's `element` argument is always the **bound text**, never
the container — regardless of which of the two carries the link.

| box | link attached to | `element` the hook received |
|---|---|---|
| A | container `3st7ohZj` | text `emjdiA50`, `containerId: '3st7ohZj'` |
| B | text `J7zzY35J` | text `J7zzY35J`, `containerId: 'IieEYMWM'` |

Consequence for the plugin: identify a chain node by `element.containerId`, not
`element.id`. Attaching the link to the container is fine and is the tidier choice,
since the container is the node's stable identity.

`linkText` arrives **unwrapped** — `'SPIKE-TARGET'`, not `'[[SPIKE-TARGET]]'`.

Plain-rect control (C) not exercised; not needed, boxed text is the shape we ship.

**From docs [src]:** the hook is
`onLinkClickHook: (element, linkText, event, view, ea) => boolean`, and
"in case you want to prevent the excalidraw onLinkClick action you must **return false**,
it will stop the native excalidraw onLinkClick management flow."
(Note: some third-party summaries claim the inverse. The official API page says `false`.)

Open question the repro settles: for a boxed text, is `element` the **container** or the
**bound text**? That decides where the plugin writes the link.

Repro: `docs/spike-ea/01-link-hook.js`
Result: fired on every Ctrl+Click, 3/3 for A and again for B. With the hook returning
`false`, **nothing opened** — no SPIKE-TARGET tab, no create-note prompt. The docs are
right and the third-party summaries claiming the inverse are wrong: `false` suppresses.

Note the interaction cost: a plain click only selects. Following a link needs
**Ctrl/Cmd+Click** or the element's link icon. `▶ Run` therefore is not a one-click
affordance out of the box — worth calling out in the UI tickets.

## Q2 — Does an embeddable showing a vault note re-render when another plugin writes that note while the drawing is open?

**Answer: YES, live. [obs]** With the drawing open and untouched, each `app.vault.process`
append appeared in the embeddable within moments — no click-away, no reopen.

Granularity is **per write**, not per character: a whole appended line appears at once.
The plugin therefore chooses the visible chunk size by choosing how often it flushes
engine output to the note. Line- or paragraph-at-a-time is the natural cadence; a
per-token write would mean a vault write per token, which is not worth it.

Repro: `docs/spike-ea/02-embeddable-rerender.js`
Result: 8 appends at 1.5s intervals, all visible live in the embeddable.

## Q3 — Does `addElementsToView(..., save=true)` race autosave or lose elements?

**Answer: NO. [obs]** 40 sequential calls with `save=true` lost nothing, and the scene
round-tripped through disk intact.

Signature [src]:
`addElementsToView(repositionToCursor = false, save = true, newElementsOnTop = false, shouldRestoreElements?)`

Repro: `docs/spike-ea/03-save-race.js`, then `docs/spike-ea/03b-verify-reload.js`
Result [obs]: the loop was run four times against the same drawing, with a full tab
close-and-reopen partway through. `addElementsToView` returned `false` 0 times in every
run, and the element count carried across the reopen exactly:

| run | count before | count after |
|---|---|---|
| 1 | 0 | 40 |
| 2 | 40 | 80 |
| — | *tab closed and reopened* | |
| 3 | 80 | 120 |
| 4 | 120 | 160 |

Run 3 seeing 80 and run 4 seeing 120 is the evidence: everything written before the
reopen was read back. No loss, no autosave race, no need to throttle or batch.

The script's own `onDisk 0/40` line is a **bad measurement, ignore it** — Excalidraw
stores the scene as `compressed-json` inside the `.md`, so grepping the raw file text
for `"spike"` can never match. The in-memory count after a reopen is the valid check.

## Q4 — Do EA hooks fire when the drawing is embedded in a markdown note rather than open in its own tab?

**Answer: YES. [obs]** Both A and B fired from inside the embedded drawing, with the
same `element`/`containerId` shape as the standalone tab. No behavioural difference
observed.

Repro: `docs/spike-ea/04-embedded-in-markdown.md`
Result: hook fired for both boxes from inside the embedded drawing —
`emjdiA50` (A) and `J7zzY35J` (B), each with its `containerId`, same shape as the
standalone tab.

Reading view vs Live Preview were not differentiated in the run; only one embedded
context was exercised. Low risk, but if #8 depends on it, re-check the other mode.

---

## EA methods actually used

Obtain the EA handle from the plugin instance rather than the window global — both exist
(`window.ExcalidrawAutomate` and `plugin.ea` were both objects on 2.26.4), but going
through `app.plugins.plugins["obsidian-excalidraw-plugin"].ea` keeps the dependency
explicit.

| method | used for |
|---|---|
| `setView("active")` | **mandatory first call** — see the gotcha below |
| `reset()` | clear the element workbench between batches |
| `addText(x, y, text, {box, boxPadding, width, textAlign})` | the chain-node box |
| `addRect(x, y, w, h)` | plain shapes |
| `addEmbeddable(x, y, w, h, undefined, tFile)` | output notes on the drawing |
| `addFrame(x, y, w, h, name)` | the frame a run's outputs land in |
| `getElement(id)` / `getElements()` | set `.link` and `.customData` before committing |
| `getViewElements()` | read what is already in the scene |
| `addElementsToView(false, true)` | commit + save |
| `onLinkClickHook` | the `▶ Run` interaction |
| `verifyMinimumPluginVersion("2.0.0")` | startup guard |

### Gotcha: `targetView` must be set, and goes stale

Every EA view operation fails with
`"targetView not set, or no longer active. Use setView before calling this function"`
unless `setView` has been called — and the binding goes stale whenever the user switches
tabs or reopens the drawing. Excalidraw's own Script Engine sets it automatically;
**a plugin must set it itself.** Call `ea.setView(view)` with the specific view at the
top of every entry point, not once at startup.

This cost the first hour of the spike: the failures are logged as plugin errors, not
thrown, so scripts appear to run successfully while drawing nothing.

## Consequences for the ticket series

1. **#8 (chain node on a drawing) — stream into embeddables.** Q2 is a yes.
2. **Node identity is `element.containerId`.** Q1: the hook always hands back the bound
   text, never the container.
3. **`▶ Run` is not one-click.** A plain click selects; following a link needs
   Ctrl/Cmd+Click or the element's link icon. Either accept that and label it, or drive
   runs from a command / context menu. **This is a UI decision #8 must make.**
4. **No batching or throttling needed** when writing elements. Q3.
5. **`setView` on every entry point**, not once at startup.

## Recommendation for "Run a chain node" (#8 — *Chain node on a drawing*)

**Stream into embeddables.** Q2 confirms a live re-render, so the run can create each
output note empty, place its embeddable immediately, and append to the note as the
engine's SSE stream arrives. The user watches outputs fill in place.

**Shipped in #9, and confirmed by hand.** Outputs fill in place as the run streams;
an output dragged out of its frame stays where it is put and edits in place.
`addFrame` — the one method in the table this spike never exercised — **exists and
works**, so a run's outputs land in a real Excalidraw frame rather than the loose
fallback the plugin carries for engines that lack it. Getting there needed three
engine changes, not just the two calls above: see ADR-0003.

Cadence: flush to the note per line or per paragraph, not per token — each flush is a
vault write, and the embeddable only repaints per write anyway.

Node identity: bind the `▶ Run` link to the **container**, and in `onLinkClickHook`
resolve the node via `element.containerId` (Q1).
