# Working with Obsidian Excalidraw

Use this when changing Chain Runner's drawing integration. It records Excalidraw
behavior that the API alone does not make clear. User steps belong in
[README.md](../../README.md); product decisions belong in [the ADRs](../adr/).
[docs/spike-ea.md](../spike-ea.md) holds the original live probes.

## Evidence boundary

The code requires Excalidraw 2.0.0 or newer. Most live observations below came
from Excalidraw 2.26.4 on Windows in September 2026. A behavior read from its
`main.js` is identified as such; it has not necessarily been tested in a vault.
`addFrame`, `addArrow`, `getViewSelectedElements`, and
`getViewFileForImageElement` are feature-detected by this plugin.

Keep source reads, automated checks, and live-vault observations separate.
The earlier #45 record did not attest that rewriting an embeddable `link` and
frame `name` survives a drawing save and reload; check current ticket evidence
before treating that path as verified.

## Bind a loaded drawing

- Reach the optional plugin through
  `app.plugins.plugins['obsidian-excalidraw-plugin'].ea`, not a window global.
- Use `ea.getAPI(view)` for a fresh instance bound to one drawing for one
  gesture. The shared `plugin.ea` can be rebound by another action or tab while
  an async run waits. `reset()` clears the workbench without dropping the view
  binding; this was read from 2.26.4, not separately run (#63).
- A click supplies its own view. Use it for an embedded drawing, which is not an
  active drawing tab. A palette command that has no clicked view needs the
  drawing open as its own Excalidraw tab.
- `setView` silently retains an old binding if given something other than an
  `ExcalidrawView`. A tab Obsidian has not loaded is not a usable view.
- `addElementsToView` can return `false` when its view has unloaded, without
  throwing. Check the return value. `src/ui/excalidraw.ts` does this in `save()`.
- Install link and scene hooks on the shared `plugin.ea`: that is where a
  normal drawing looks for them. Chain any previous hook and restore it on
  unload; each handler should pass through elements it does not own.

## Interpret clicks

`onLinkClickHook` sees only an element with a `link`. Following that link on an
Excalidraw canvas needs Ctrl/Cmd+click. Chain Runner uses
`chain-runner://` links so an escaped click cannot create a vault note.

For plain clicks, `onSceneChangeHook` is an object with `appStateKeys` or
`trackElements` and a `callback`; without either filter it never fires. Watch
`selectedElementIds`, then apply the click policy in
`src/ui/selectionClick.ts` and `src/ui/pointerClicks.ts`:

- Ignore unchanged, multi-element, keyboard, and drag selections. The scene
  report may arrive before *or after* `pointerup` because it comes through
  React's `onChange`. A completed press must remain briefly available to a
  later report.
- A grouped node first reports its whole group; only the drill-in reports one
  line. An already-selected line may report no change at all. A picker can use
  that one-line report; clicking away and back or Ctrl/Cmd+click also works.
- The browser's `dblclick` does not arrive over this canvas. Count
  `pointerdown`/`pointerup`, then wait for the one-element drill-in report to
  identify which line was hit. Do not consume that report: the chain, parameter,
  and count pickers need it too. `editingTextElement` can identify a text line
  on a second route, but the editor may not open from an empty selection.

ADR-0010 records the gesture policy and failed approaches:
[plain click and double-click](../adr/0010-a-plain-click-opens-the-picker-beside-the-node.md).
It also explains why the picker is an anchored Obsidian `SuggestModal` rather
than elements written onto the drawing. A suggest modal's `modalEl` is the
`.prompt` element, so positioning CSS must address that element.

## Read material from the scene

| What the user inserted | Scene element | Where to read it |
| --- | --- | --- |
| Vault note via **Insert file from vault** | `image` | `getViewFileForImageElement`; use only `.md` files |
| Note as an embeddable | `embeddable` / `iframe` | `element.link`, usually `[[path]]` |
| Text typed inside a box | `text` with `containerId` | The bound text, not the container |
| Standalone text | `text` | `originalText`; `text` may be wrapped |

An `image` can also be a picture. Do not try to read it as a note merely
because it is an image element.

## Write and identify scene elements

- `copyViewElementsToEAforEditing` keeps element ids, so writing its copies
  back edits in place. Mark a copied element `isDeleted = true` to remove it.
- On a text edit set `text`, `originalText`, and `rawText`, then call
  `refreshTextElementSize`. Excalidraw saves its own text map from `rawText`;
  omitting it makes the old words return after save (#20).
- A candidate displayed in a bound text box needs the bound text's `rawText`
  and its box's height updated together; the box and text are separate scene
  elements.
- Scripted elements need their `frameId` when placed inside a frame. A new
  line in an existing node also needs the box's `groupIds`. Excalidraw does
  not infer those memberships on placement.
- Each write saves the drawing. Avoid writes on every drag frame or merely
  because a click occurred. A resize is handled on pointer release, with a
  stored laid-out width to skip unchanged nodes (ADR-0011).
- Stamp each element of a feature in its own `customData` key. It survives
  move, copy, and reload. Copies share the stamp but get a new group id; the
  group distinguishes copies. Clear only Chain Runner's own key.
- A rerun files new output notes and repoints cards' `link` values; it does
  not overwrite the previous run's notes. Progress appears in the rendered
  note header, so it needs no scene write. These are Chain Runner choices;
  see [ADR-0004](../adr/0004-a-run-reference-is-resolved-when-it-is-shown.md)
  and [ADR-0003](../adr/0003-outputs-fill-in-place.md).

Re-shaping a node keeps its box and its id so bound arrows survive. Only its
lines are updated, added, or removed. The decision is in
[ADR-0009](../adr/0009-a-node-re-shapes-around-its-chain.md).

## Install the drawing button

Excalidraw's shape strip is its own React component. Its script engine puts
**Add chain node** in the Obsidian Tools Panel (the top-right gem). The
installed files are produced by `src/ui/toolScript.ts`:

- Scripts live under `settings.scriptFolderPath` (default
  `Excalidraw/Scripts`). An `.md` script contains executable JavaScript, not
  a fenced code block. Excalidraw removes YAML frontmatter and runs its body
  with `ea` and `utils` in scope.
- A same-name `.svg` beside the script supplies its icon. Excalidraw also
  registers `(Script) <name>` as a command. A 1.5-second press pins the
  button beside the gem.
- The script gets Obsidian through `ea.plugin.app` and the clicked drawing
  through `ea.targetView`. Chain Runner writes changed script files on load;
  unnecessary rewrites make Excalidraw reload the toolbar.

These script details were read from Excalidraw 2.26.4; the button and icon
were subsequently observed in a vault (#20).

## Layout constraints

A standalone text element needs `autoResize: false` and an explicit width to
avoid scaling its type when resized. A group resize still changes `fontSize`;
put the designed size back when re-laying out a chain node (ADR-0011).
Excalidraw measures its font after placement, so width calculations here are
estimates. Canvas elements cannot read Obsidian CSS variables; use
Excalidraw's palette and check both light and dark themes.

## Debug a drawing

A `.excalidraw.md` file usually stores compressed scene JSON, but its readable
Markdown sections often answer the first question:

- `## Text Elements`: saved text
- `## Element Links`: element id to link
- `## Embedded Files`: file id to `[[note]]` for inserted vault files

For a blank output card whose linked note has the expected new text (#72),
inspect the card's link and `## Element Links`, then reproduce with the drawing
open as a loaded Excalidraw view. The note write alone does not prove the
embeddable rendered. The original spike observed live refresh after
`app.vault.process` writes (Q2); that did **not** resolve #72. Also check
whether a scene write returned `false` after its view unloaded.

Keep the scene and gesture decisions pure and test them without a vault.
Drawing API calls still need a short, ticket-specific live vault check; state
what that check has and has not established. Add new Excalidraw findings here
only when they change how an agent should read, write, or debug a drawing.
