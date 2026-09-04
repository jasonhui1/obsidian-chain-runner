# Working with Obsidian Excalidraw

What this repo has learned about `obsidian-excalidraw-plugin`, beyond what its
API says. `docs/spike-ea.md` is the original probe — its Q1–Q3 answers are not
repeated here. This is the log kept since: what later tickets attested, and what
bit us.

Every fact below is a fact about *their* plugin. All of it lives behind
`src/ui/excalidraw.ts`, so a change on their side is a change in one file on
ours. Add to this log when a vault teaches you something a test could not.

## Attested against

Excalidraw **2.26.4**, Obsidian on Windows, 2026-09-04. The version floor the
code enforces is 2.0.0; every call below predates it, but "predates" is not
"verified" — the table says which have actually run.

| Call | Attested |
| --- | --- |
| `addText`, `addRect`, `addEmbeddable`, `addToGroup` | spike, and every ticket since |
| `copyViewElementsToEAforEditing`, `addElementsToView` | #8, #9 |
| `addFrame` | #9 |
| `addArrow` | #12 — binds a connector to both ends |
| `getViewSelectedElements` | #12 |
| `getViewFileForImageElement` | #12 |
| `isDeleted = true` on a copied element | #12 — this is how a scripted element is removed |
| `rawText` on an edited text element | #20 — a rewrite without it does not survive the save |
| `style.fontSize` before `addText` | #20 — unset, every line draws at EA's default and the layout collapses |
| `settings.scriptFolderPath`, the script engine's file shapes | #20 — read out of their `main.js` |
| `groupIds` copied onto a scripted element | #20 — how a new line joins a node already on the scene |
| the hook list, `onSceneChangeHook`'s shape and `appStateKeys` filter, `ea.FloatingModal`, `addText`'s `autoResize` | #21 — read out of their `main.js` at 2.26.4, **read, not run** |

`addFrame`, `addArrow`, `getViewSelectedElements` and
`getViewFileForImageElement` are feature-detected rather than assumed. A build
without one is a version notice, not a silent no-op.

## Reaching it

Through the plugin instance (`app.plugins.plugins['obsidian-excalidraw-plugin'].ea`),
never the window global, so the dependency stays explicit and optional.

**`setView` on every entry point.** The binding goes stale when the reader
switches tabs. Set it per call, not once at load. A click carries its own view —
use that over the tab in front, because a drawing embedded in a note is not a
tab.

## Clicks

**A plain click is reachable — through selection, not through links.** The
spike's "only a link fires the hook" is true of `onLinkClickHook` alone, and was
wrongly written here as a fact about clicks. Read out of `main.js` at 2.26.4:

- `onLinkClickHook` fires only on an element carrying a `link`, and following
  one needs Ctrl/Cmd+click.
- `onSceneChangeHook` is an **object**, not a function:
  `{ appStateKeys?, trackElements?, triggerWhenInvisible?, callback }`. Without
  `appStateKeys` or `trackElements` it is **never called at all**. The callback
  takes `(elements, appState, files, view, ea)`. Filtering on
  `selectedElementIds` makes an unmodified click on an element actionable —
  `registerSelectionHook` is that, and `src/ui/selectionClick.ts` is the policy
  saying which of those changes is a click (ADR-0010).
- The view calls `getHookServer()`, which is `this.hookServer ?? this.plugin.ea`
  — so setting the hook on the shared `ea` reaches an ordinary drawing.

An affordance built on links still needs its own element carrying one. Use a
`chain-runner://` scheme, so a click that escapes the hook fails as an
unopenable link rather than creating a note. And Ctrl/Cmd+click is not one
click: anything the spec calls one-click needs a **command** acting on the
selection as well as the label.

What a selection hook has to guard against, since it fires on *every* scene
change:

- the selection may not have changed — compare against the last one seen;
- the selection may not be one element — a rubber-band or Select All must not
  pop a modal;
- **it fires on pointer-*down***, before the reader has finished doing anything.
  A drag of the element reports exactly the same selection change as a click, so
  a hook that acts immediately pops a modal in the middle of a drag. Wait for the
  pointer to come back up near where it went down
  (`src/ui/pointerClicks.ts`);
- selection is not only clicking — a keyboard selection has no press behind it at
  all, and the same wait is what catches that.

EA holds one of each hook, so the last installer wins; chain the previous one
and put it back on unload, as `registerLinkHook` already does. Handlers claim
their own elements and pass on what is not theirs.

The full hook list at 2.26.4: `onCanvasColorChangeHook`, `onDropHook`,
`onFileCreateHook`, `onFileOpenHook`, `onImageExportPathHook`,
`onImageFilePathHook`, `onLinkClickHook`, `onLinkHoverHook`, `onPasteHook`,
`onSceneChangeHook`, `onTriggerAutoexportHook`,
`onUpdateElementLinkForExportHook`, `onViewModeChangeHook`, `onViewUnloadHook`.

## Putting a panel near a node

**A true in-canvas dropdown is not available.** The canvas is their React
component; drawing the options as elements would dirty the file, because every
write to a drawing is a save.

`ea.FloatingModal` is a getter returning a subclass of Obsidian's `Modal` —
draggable, and it does not dim the background. It is a `Modal`, though, not a
`SuggestModal`, so a picker built on it would be a fuzzy search written again
from scratch. This repo went the other way (ADR-0010): keep the `SuggestModal`
and move it, with `position: absolute` and an inline spot. **A suggest modal's
`modalEl` is the `.prompt` element**, not `.modal`, so the CSS has to name both.

**Nothing here converts scene coordinates to the screen.**
`sceneCoordsToViewportCoords` lives in `excalidrawLib`, which is not on
`ExcalidrawAutomate`. Anchoring to the last `pointerdown` avoids the whole
question, and survives zoom, scroll and a drawing embedded in a note.

**Deselecting is not available.** `selectElementsInView` returns early on an
empty list, so a plugin cannot clear the selection — which is why clicking an
already-selected element can never be seen.

## Resizing a text element

Dragging a text element's handles **scales the font** rather than revealing more
text. That is Excalidraw's `autoResize` behaviour, not a bug on our side.
`addText` takes `autoResize` in its formatting, and computes it as
`!!box || (autoResize ?? true)` — so it only takes effect on a text element that
is **not** bound into a container, and their own docs pair `autoResize: false`
with a width. A chain node's lines are standalone text drawn at a known width,
so they pass `autoResize: false` (ADR-0010).

## What a block on the scene actually is

The type you get is not the type you expect. This has bitten twice.

| The reader did | Element type | Where the vault file is |
| --- | --- | --- |
| Insert file from vault | `image` | Excalidraw's own map — **not** `element.link`. Ask `getViewFileForImageElement`. |
| Insert as embeddable | `embeddable` / `iframe` | `element.link`, as `[[path]]` |
| Typed text in a box | `text` with `containerId` | the hook hands back the bound text, never the container |
| Drew a text block | `text` | `originalText` is the unwrapped truth; `text` is re-wrapped |

An `image` may equally be a picture. Take the note only when its extension is
`md` — a picture has no body to read.

## Writing back

- `copyViewElementsToEAforEditing` keeps ids, so writing them back edits in
  place rather than adding a second copy.
- Changing a text element means setting **all three** of `text`, `originalText`
  and **`rawText`**, then `refreshTextElementSize`. `rawText` is the one that
  matters: Excalidraw keeps a `textElements` map of its own keyed by element id,
  writes *that* into the `## Text Elements` markdown on save, and re-parses from
  it on load — so a text element edited without it snaps back to its old words
  the moment the drawing is saved. Their own code does
  `el.text = el.originalText = el.rawText = …`; ours must too. #20 lost every
  text rewrite to this, having set only the first two.
- A scripted element has to claim its `frameId`. Only a *drop* is worked out for
  you.
- Removal is `isDeleted = true` on the copy, then write back.
- Every write is a save. Only a change of words should earn one.

## Identity

`customData` survives moving, copying and a file reload — element ids do not
(they are re-made on copy). Stamp every element of a thing, so a reader who
copies one line still gets something that knows what it is.

Copies share the stamp, so the stamp alone cannot tell two copies apart.
Excalidraw re-makes the **group** on copy: that is what distinguishes them.

Give each feature its own `customData` key, and clear only your own key when you
un-stamp an element — another plugin's stamp on the same element is not yours to
drop.

## The script engine, and the toolbar

A plugin cannot add a tool to Excalidraw's shape strip — that strip is their own
React component. Their **script engine** is the way onto the canvas, and it was
read out of `main.js` at 2.26.4:

- Scripts are files under `plugin.settings.scriptFolderPath` (default
  `Excalidraw/Scripts`). Excalidraw watches the folder and loads on change.
- A script is an **`.md` file that is JavaScript**. Excalidraw strips a YAML
  frontmatter block and hands the rest to `new AsyncFunction("ea","utils", body)`.
  A code fence would be a syntax error, not a code block.
- The button's icon is an **`.svg` file beside the script with the same
  basename** (`getIMGFilename(path, "svg")`). Without it the button is a cog.
- Each script also becomes a command, named `(Script) <name>`.
- Scripts render as icon buttons in the **Obsidian Tools Panel**, reached by the
  gem in the canvas's top-right. A tap runs one; a **1.5-second press** pins it
  (toast `Pinned: <name>`). Pinned scripts render as buttons beside the gem.

Only `ea` and `utils` are in scope — no `Notice`, no `app` of its own. `ea.plugin.app`
is the way to Obsidian and `ea.targetView` is the drawing the button was pressed
on. `throw` is all a script has for saying something went wrong.

So the button ships as two files this plugin writes into that folder on load
(`src/ui/toolScript.ts`), and the reader pins it once. Only changed content is
written: Excalidraw reloads a script on every file change.

## Re-shaping a node in place

Changing which chain a node runs is not a text rewrite — the moment and the
dropdown belong to the chain, so lines appear, disappear and move. Two things
this constrains:

- **Keep the box.** Arrows bind to element ids, so deleting and redrawing the
  node would drop every input bound into it. `chainEdits` matches a freshly
  built node against what is there by role, and only adds and removes lines.
- **A line drawn now claims its own `groupIds` and `frameId`**, copied off the
  box. As with `frameId`, only a *drop* is worked out for you.

## Geometry and colour

**The font is not measurable from here.** Width is an estimate (this repo uses a
0.58 glyph-width ratio for Excalidraw's hand-drawn font); Excalidraw re-measures
on its own. Guard against a runaway line rather than trying for a precise fit.

**Derive spacing from the metric that owns it.** #12 spaced cards 24px apart by
eye while the labels under each card reached 30px, so every card's labels landed
on its neighbour — invisible to every test and obvious in one screenshot. When
one module's layout depends on another's size, publish the size and compute the
gap. Then a test can assert the two never overlap.

**Canvas elements cannot read CSS variables**, so Obsidian's theme variables are
no use: use Excalidraw's own palette and let its canvas inversion carry dark
mode. Check both themes by hand.

## Reading a drawing to debug it

`.excalidraw.md` stores its scene as `compressed-json` by default, but the
markdown above it is readable and often enough:

- `## Text Elements` — every text element's words
- `## Element Links` — element id → link
- `## Embedded Files` — file id → `[[note]]`, which is where an `image`'s note
  hides

Reading those three sections answers "what did that actually become on the
scene" faster than decompressing.

## Testing

None of this is reachable without a vault. Keep the decisions pure — where a
thing lands, what a stamp means, what an edit changes — and drive them in tests;
leave `src/ui/excalidraw.ts` as the one untested seam.

A manual pass is therefore not optional. `README.md` keeps the steps and a
**Last recorded run** table saying which have actually been run, and against
what. Record the result there, including what a vault found that the tests could
not.
