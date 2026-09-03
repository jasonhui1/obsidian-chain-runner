# Chain Runner

An Obsidian plugin that pairs vault material with [maestro-playground](https://github.com/jasonhui1/maestro-playground) insight chains.

The plugin loads, knows whether the engine is up, and can run a chain on the note in front of you — the **quick path** — reading the result in the right sidebar. It can also put a **chain node** on an Excalidraw drawing: a box naming the chain, with its dropdown and a `▶ Run` link.

## Dependencies

- **[Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin)** (community plugin) — **required** for the drawing surface. Chain nodes, run frames, and output embeddables are all Excalidraw elements, reached through its `ExcalidrawAutomate` API. Obsidian's built-in Canvas is not used: it has no official plugin API. Nothing in this slice touches Excalidraw yet, but every later ticket does — install it before going further.
- **maestro-playground** — the engine. Runs separately, on `http://localhost:3000` by default.
- Desktop only. The plugin opens its own HTTP connections to stream a run.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Engine URL | `http://localhost:3000` | Where maestro-playground is listening. |
| Output folder | `chains/runs` | Where a panel kept as a note is written. Each run gets a folder of its own inside it. |

A URL typed without a scheme gets `http://`; a trailing slash is dropped; emptying the box restores the default. The tidied value is written back into the box, and the engine re-checked, when the field is left — not on every keystroke. The output folder is tidied the same way, and emptying it restores the default rather than writing run notes loose in the vault root.

## Status bar

A pill in the status bar says whether the engine answers, re-checked every three seconds:

| Pill | Meaning |
| --- | --- |
| `⛓ …` | The first check has not answered yet. |
| `⛓ engine` | The engine answered. |
| `⛓ offline` | Nothing is listening at the engine URL. |

An engine that answers with an *error* is still online — a broken workspace is not a stopped server.

The poll asks for `/api/runs/chain-runner-probe`, a run id nothing matches, because the engine answers it from one failed file read. `/api/workspace` would also answer, but it reads and serialises the whole workspace off disk — too much to repeat every three seconds.

Any plugin action taken while the engine is offline shows a `engine offline` notice and does nothing else.

## Commands

| Command | What it does |
| --- | --- |
| **Chain Runner: Run chain on this note** | The quick path, below. |
| **Chain Runner: Add chain node** | Puts a chain node on the Excalidraw drawing in front of you. |
| **Chain Runner: List chains on the engine** | Fetches the workspace's chains and shows the count in a notice. The smoke test below uses it. |

## The quick path

**Chain Runner: Run chain on this note** takes the note you are reading — or the selection, when you have one — and runs a chain against it. Nothing is drawn; the result reads in the right sidebar.

**What the run reads.** The note and the selection are read from one pane — the editor you are in — so a selection left behind in another pane can never be run under a different note's name. With nothing selected the whole note is the seed, minus its frontmatter: tags, aliases and dates are the vault's bookkeeping, not part of the argument the chain is asked to read. Select a passage and that passage is the seed instead, left exactly as it was highlighted — frontmatter inside a selection was selected on purpose. The result header names the note either way, and adds `(selection)` when the run covered less than it: `seed: premise.md (selection)`.

**Picking a chain.** The picker groups chains under the four headings the engine's own picker uses: 洞見 (insight), 產出 (production), 壓力測試 (stress-test), and `unclassified` for a chain that declares no `purpose`. Under each name sits the chain's `moment` in grey — the situation that should make you reach for it — falling back to its `description`. Typing filters across every group at once, matching the name, the slug, the moment and the description; a heading with nothing left under it disappears.

Two things the picker says before you commit to a run: a chain that declares a dropdown asks for its value first, because a chain reads its parameter as an input; and a chain that declares no seed node is marked *reads its own files — this note is not used*, since it runs off the files it pins and the note you invoked it on reaches nothing.

**The dropdown.** A chain declaring a `parameter` gets one more suggester — the same modal shape as the picker, with the chain's own options — and the run starts on the pick. A chain declaring none launches straight from the picker, and a dropdown declared with no options is not asked for, since there would be nothing in the modal. The value goes out with the run as `paramValue`, so the engine records it on the run alongside the seed, and the header shows it next to the seed line.

**Reading the result.** One panel per output the chain declares, in the order it declared them, drawn in the shape it asked for:

| Chain declares | Panels |
| --- | --- |
| `view: timeline` | Stacked, one per hop, last one emphasised — the surviving skeleton. |
| `view: columns` | Side by side, one column per branch; the `role: join` column is wider and its heading bold. |
| `view: sidebar` | Rounds down the left, the one you are reading in a detail pane. |
| nothing | The run trace, stacked: one panel per node that ran, in the order it ran. |

The shape is the engine's `kind` and the panels are the engine's panels; the plugin only decides where each one lands, in `src/ui/arrangement.ts`. A columns layout streams like any other — a branch still writing shows its tokens in its own column. In a sidebar layout the detail pane follows the front of the run — the round being written, or the last one that landed — until you click a round, and it follows again on the next run.

A panel shows the section its port asked for, resolved the way the engine resolves an edge — so a panel here holds what the next hop actually received, and matches the same run opened in maestro-playground.

| Panel state | What it means |
| --- | --- |
| *writing…* | The hop is streaming; what you see is what it has written so far. |
| *waiting* | The run has not reached this hop yet. |
| *never ran* | The run settled without reaching it. |
| *nothing survived* | The hop finished and dropped the section the chain asked it for. |
| *this hop failed* | The hop errored; the engine's own message follows. |
| *skipped* | Control flow went the other way. |

### Keeping a piece

A panel worth keeping has two actions in its heading: **Save as note** and **Send to drawing**.

Both appear on a **filled panel of a run that has finished**, and on no other. An output note is stamped with the run id, and the engine reports the run id when the run completes — so before that there is nothing to stamp. A panel that is empty, errored, skipped or still writing has nothing worth keeping either.

**The output-note convention.** Every surface that keeps a piece of a run — these two actions now, the drawing's embeddables later — writes the same note:

```
chains/runs/<runId>/<output>.md

---
run: "2026-09-02-ab12c"
chain: "Five Personas"
output: "Optimist"
---

<the hop's text, exactly as the panel showed it>
```

- **The folder** is the **Output folder** setting, with a folder per run inside it. Missing folders are created.
- **The filename** is the chain's own name for the output — case, spaces and all — with only what a filename cannot hold (`\ / : * ? " < > | # ^ [ ]`) replaced by a dash, and dots and spaces trimmed off either end. A name left with nothing after that — `///`, or `...` — is filed as `output.md`.
- **The frontmatter** is those three keys and no others, every value quoted, so a chain named `2026-09-02` stays a string.
- **The body** is the hop's text untouched. A hop that wrote its own frontmatter or its own heading keeps it, below this one.
- **A collision gets a suffix** — `Optimist 2.md`, `Optimist 3.md` — *unless* the note already there says exactly this, in which case it is reused. So saving a panel and then sending the same panel to a drawing leaves one note, not two copies of one hop.

The whole convention is `src/run/outputNote.ts`: a panel and a run's meta in, a file path and a file's content out, checked in `tests/outputNote.test.ts` without a vault.

**Save as note** writes the note and opens it in a new tab.

**Send to drawing** asks which drawing to put it on, and writes the same note once one is picked — dismissing the suggester leaves nothing behind. The drawings offered are: the drawings open right now first, then the ones opened recently in the order they were read, then the rest newest-written first. The note lands on the picked drawing as an **embeddable at the cursor**, and the drawing is saved. A drawing that is not open is opened first — Excalidraw's `ExcalidrawAutomate` can only be pointed at a live view.

This needs the Excalidraw plugin, 2.0.0 or newer; without it the action says so and writes nothing. `docs/spike-ea.md` records why those are the calls: the version floor, the mandatory `setView` on every entry point, and the observation that an embeddable re-renders live when the note behind it is written.

**The run is the engine's.** `POST /api/run` records it like any other, so it appears in maestro-playground's history with a normal run id. The plugin keeps no second run store.

Starting a second run replaces the first — the sidebar holds one view, and the run it was showing is aborted rather than raced.

## Chain nodes on a drawing

**Chain Runner: Add chain node** puts one chain on the drawing you are looking at:

```
╭────────────────────────────╮
│ ⛓ Five Personas            │
│ when a premise feels safe  │
│ audience ▾ engineers       │
│                    ▶ Run   │
╰────────────────────────────╯
```

The picker is the quick path's, with the same four purpose headings and the same grey `moment` under each name — only the question differs, and a chain that reads no seed is marked *reads its own files — bound inputs are not used*. A chain declaring a dropdown asks for its value **before** the node is placed: the alternative is a node that arrives reading `audience ▾ unset` and needs a second interaction before it means anything. The node lands **at the cursor**, grouped, and the drawing is saved.

A line too long for the box is trimmed with an ellipsis rather than wrapped. Excalidraw wraps to the width it is given, and a wrapped line would push the ones under it out through the bottom — a chain with a two-sentence moment would stop being one box. The box is a label; the full text is a click away in the picker.

**Two links, and neither opens anything.** `audience ▾ engineers` re-asks the chain's own options and rewrites the value where it stands; `▶ Run` is intercepted and, for now, says that running a node arrives in the next ticket. Every element of a node swallows its click, so a node that has been copied or half-deleted can never open a browser tab or make a note in the vault. Following a link on an Excalidraw canvas is **Ctrl/Cmd+click** (or the element's link icon) — a plain click only selects.

**What the drawing stores.** Each of the node's five elements carries the same stamp in Excalidraw's `customData`: which node it belongs to, which part of the node it is, the chain's slug and name, and the parameter's name and value. `customData` survives moving, copying and a file reload, so a node keeps working across all three, and a value set on it is still there after Obsidian restarts. Copying a node copies the stamp too, so both copies claim one id — Excalidraw re-makes the *group* on copy, and that is what keeps a rewritten parameter on the copy you clicked.

**Colours are Excalidraw's, not Obsidian's.** A canvas element cannot read a CSS variable, and Excalidraw inverts its whole canvas in dark mode — so the node uses that palette's own ink, grey and blue, and reads correctly in both themes because the canvas, not the plugin, does the flipping. Everything else in the plugin still uses Obsidian's variables.

**Where it works.** Adding a node needs the drawing **open as its own tab**: the command acts on the tab in front of you, and a drawing embedded in a markdown note is a markdown tab. Clicks on a node work in both: the spike found the link hook fires inside an embedded drawing exactly as it does in a standalone one (`docs/spike-ea.md`, Q4), and the hook hands over the view the click happened in — which is the only handle on an embedded drawing, since it is not a tab that can be looked up. The spike exercised one embedded context without differentiating Reading view from Live Preview, so that much is unattested.

One shape the spike did not exercise: it observed the hook on text **bound into a box**, and noted that a plain-rect control was not tried. A node's links sit on standalone text elements, so the observation is one step away from what ships — the first thing to check if a click ever falls through.

Excalidraw 2.0.0 or newer is required, and the version is checked before anything is placed — an older one says so in a notice and nothing is drawn.

### Where an output came from

Every output note says which run wrote it. The frontmatter carries `run`, `chain` and `output`, and a `source` link to the run on the engine as it was addressed at the time; above every *rendering* of the note — inside an embeddable on a drawing as much as in the note's own tab — sits one faint line reading **source run**, linking to the engine's view of that run.

That line is rendered rather than stored, and built from the engine URL set *now* (ADR-0004). Moving the engine to another port or machine moves every header with it; the `source` key in the file is for readers outside this plugin and is never read back. It also keeps the provenance out of the note's own text, which matters for the next paragraph.

**An output is material.** Arrow an output's embeddable into another chain node and it is an ordinary note input: the second run reads the hop's words, with the frontmatter stripped the way any bound note's is, and lands in a frame of its own titled with its own run id. Both runs are in the engine's history; neither knows about the other.

**A run that is gone reads as gone.** The header asks the engine whether the run is still there. An engine that answers and has no such run turns the line into **source run deleted**, in amber; an engine that cannot be reached leaves the link alone, because an engine that is down is not a run that was deleted. Nothing throws either way, and the answer is remembered per run so a note being written line by line does not ask once per repaint.

## Development

```bash
npm install
npm run dev        # esbuild watch → main.js
npm run build      # typecheck + production bundle
npm test           # vitest
npm run typecheck
npm run lint
npm run smoke      # the engine half of the manual smoke, against a live engine
```

To load it in a vault, symlink or copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/chain-runner/`, then enable it in **Settings → Community plugins**.

### Architecture

```
src/
  main.ts               plugin entry: settings, status pill, commands
  settings.ts           persisted settings and URL normalisation
  engine/
    types.ts            the engine's wire shapes, narrowed to what is read
    transport.ts        HttpTransport seam + the three failure kinds
    nodeTransport.ts    the desktop implementation, over node:http
    sse.ts              SSE framing
    client.ts           listChains / launchRun / getRun / getLayout / runExists / ping
    status.ts           the online-offline poll loop
    guard.ts            the offline guard every action goes through
  run/
    section.ts            section addressing, for scoping a half-written hop
    panels.ts             the engine's panels, plus live tokens and the trace fallback
    session.ts            the event fold, and the result the view renders
    seed.ts               what a run reads: the selection, or the note
    outputNote.ts         the output-note convention: path, frontmatter, collisions
    provenance.ts         the run an output note came from, and whether it still exists
  ui/
    pickerModel.ts        the picker's groups and order
    arrangement.ts        where a layout's panels go: stacked, columns, or rounds
    drawingChoices.ts     which drawings the send-to-drawing suggester offers, in order
    chainNode.ts          what a chain node is: its elements, its stamp, its rewrites
    chainPicker.ts        the chain and parameter modals
    drawingPicker.ts      the drawing suggester
    panelCopy.ts          what a panel says when it has nothing to show
    throttle.ts           how often the result view redraws
    resultView.ts         the right-sidebar view
    keepPiece.ts          the two panel actions: write the note, put it on a drawing
    sourceRunHeader.ts    the source-run line above every rendering of an output note
    chainNodes.ts         the add command, and what a click on a node's links means
    excalidraw.ts         the Excalidraw plugin, as this plugin reaches it
    quickRun.ts           the command: note → picker → stream → view
    settingsTab.ts, statusPill.ts
```

`src/ui/chainNode.ts` is pure in the same way: what a node holds, where each line sits, and what changes when its parameter is rewritten are decisions, checked in `tests/chainNode.test.ts` without a drawing. `src/ui/chainNodes.ts` holds what is asked before a node is placed and what each link click means, driven against a fake surface in `tests/chainNodes.test.ts`.

`src/run/outputNote.ts` and `src/ui/drawingChoices.ts` are pure for the same reason the rest of `src/run/` is: what a kept note is called and what it says, and which drawing is offered first, are decisions rather than vault operations. `src/ui/keepPiece.ts` is the seam that holds the vault writes, driven in `tests/keepPiece.test.ts`; `src/ui/excalidraw.ts` holds every fact about the other plugin — its id, its version floor, the calls the spike found work — so a change on their side is a change in one file on ours.

`src/run/` holds no Obsidian import: what a stream of engine events means, and what panels it becomes, is decided there and checked without a vault. `src/ui/arrangement.ts` is vault-free too, and for the same reason — it is a drawing decision rather than a run one, so it sits in `src/ui/`, but where a panel lands is checkable without Obsidian and is checked that way. What is left in the view itself is the three things only a view can do: markdown, how often to redraw, and what a click means.

`src/ui/quickRun.ts` is where the two meet, and the decisions it makes — which note, how much of it, whether to ask for the dropdown — are driven in `tests/quickRunner.test.ts` against `tests/obsidian.ts`, a stub that records modals instead of drawing them (aliased over `obsidian` in `vitest.config.ts`). Typechecking still runs against the real module, so a stub that drifts from Obsidian's API fails `tsc` rather than passing a green suite.

**The engine projects the panels; the plugin draws them.** `POST /api/run` streams a `layout` frame — one before the first hop, one after every `agent_done` — carrying the engine's own `buildLayoutModel` output (maestro-playground ADR-0017). The plugin holds no copy of that rule, so a chain edited in the workspace changes what is drawn here without this repo being touched.

`src/run/panels.ts` adds only the two things the engine has no reason to know about:

- **Live tokens.** A panel still `pending` is handed what its node has written since it started, keyed by the panel's `node`. The partial is scoped to the socket the port asked for, so a panel never shows a blob it then replaces with a section of itself — except where two ports on one node disagree about the socket, where the raw partial is shown rather than a guessed one.
- **The trace fallback.** A chain declaring no layout gets `{ kind: 'undeclared', panels: [] }`, which is the cue to draw one panel per node that ran rather than a frame still to come.

**Feature-detected, not version-pinned.** `GET /api/workspace` reports `capabilities`. The quick path checks `runLayoutFrames` before opening the picker and refuses to run without it — an engine too old should stop you, not let the view draw a rule it no longer owns.

The network sits behind `HttpTransport` for two reasons. Obsidian's `requestUrl` cannot stream a response body, and a renderer `fetch` to `localhost` is a cross-origin request the engine sets no CORS headers for — so the runtime implementation goes through Node's `http` directly. And with the seam there, the tests drive the real client against a real local server (`tests/fakeEngine.ts`) rather than a stubbed `fetch`.

## Manual smoke against a live engine

The automated suite runs against a fake engine (`tests/fakeEngine.ts`). This checks the same client against the real one. Run it after any change to `src/engine/`.

### Part one — the engine half, scripted

With maestro-playground running (`npm run dev` in its checkout):

```bash
npm run smoke                                # ping, listChains
npm run smoke -- --run-id <an existing run>  # also getRun, getLayout
npm run smoke -- --launch                    # also launchRun — spends real model tokens
```

`--launch` is opt-in because it starts a real chain run and bills for it.

### Part two — the Obsidian half, by hand

1. **Build and install the plugin.** `npm run build` here, then copy `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/chain-runner/` and enable it.
2. **Status bar, online.** The pill should read `⛓ engine` within a few seconds of the vault opening. Hovering it shows the engine URL.
3. **Status bar, offline.** Stop the engine (Ctrl-C). The pill flips to `⛓ offline` within a few seconds. Start it again; it flips back within a few seconds.
4. **Offline action.** With the engine stopped, run **Chain Runner: List chains on the engine** from the command palette. Expect exactly one notice, `engine offline`, and nothing else.
5. **Online action.** Start the engine and run the same command. Expect a notice naming the chains in the workspace — the same names the playground's own chain list shows.
6. **Wrong URL.** Set **Engine URL** to `http://localhost:3999`. The pill goes offline without a restart. Set it back; it comes online.
7. **Both themes.** Switch between light and dark (**Settings → Appearance**). The pill stays legible in each; it uses `--text-success`, `--text-error`, `--text-faint` and no colours of its own.

### Part three — the quick path, by hand

This half spends model tokens: every step from 3 onwards starts a real run.

1. **The picker.** Open a note with something in it and run **Chain Runner: Run chain on this note**. Expect the four purpose headings, each chain's name with its moment in grey beneath, and a `moment` that matches what the playground's own launch form shows for the same chain.
2. **Fuzzy search.** Type a fragment of a chain's *moment* rather than its name. Expect it to survive the filter, and expect headings with nothing left under them to disappear rather than sit empty.
3. **A declared timeline.** Pick a `view: timeline` chain. Expect: the sidebar opens; one panel per declared output appears at once, the last one emphasised; each fills in as its hop lands; tokens appear as the hop writes them, smoothly rather than in a jerk per token.
4. **The same run in the playground.** When it finishes, open the run id the header shows in maestro-playground's history. Expect the same panels, in the same order, with the same panel emphasised and the same text in each.
5. **Panel states.** Run a chain whose hop drops a section a later port asks for, and one whose hop fails. Expect *nothing survived* and *this hop failed* respectively, the second carrying the engine's message, and any hop the run never reached reading *never ran* once it settles.
5b. **A selection.** Select one paragraph of the note and run the command. Expect the header to read `seed: <note>.md (selection)`, and the run to be about that paragraph rather than the whole note. With nothing selected, expect `seed: <note>.md` and no qualifier.
6. **A chain with a dropdown.** Pick one that declares a `parameter`. Expect a second modal asking for it before the run, the value in the result header, and the same name and value on the run when it is opened in the playground's history.
6b. **A chain that pins its own files.** One with no `seed` node should carry the *reads its own files* line in the picker.
6c. **A columns chain.** Pick a `view: columns` chain. Expect the branches side by side rather than stacked, the `role: join` column wider than them with its heading bold, and each column streaming its own hop's tokens as it writes.
6d. **A sidebar chain.** Pick a `view: sidebar` chain. Expect the rounds listed down the left and one of them open on the right; expect the detail pane to move to the round being written as the loop runs, and to stay on a round you click until the next run.
7. **A chain declaring no view.** Expect the run trace fallback and a line saying so, not an empty view.
7b. **Save as note.** With a finished run on screen, click **Save as note** in a filled panel's heading. Expect a note at `chains/runs/<runId>/<output>.md`, opened in a new tab, carrying `run`, `chain` and `output` in its frontmatter and the panel's text below. Click it again: expect the same one note, not a second. Expect neither action to appear on a panel while the run is still going, nor on an empty, errored or skipped one.
7c. **A collision.** Write your own note at that exact path, then save the panel again. Expect `<output> 2.md` beside it and your note untouched.
7d. **Send to drawing.** With an Excalidraw drawing open, click **Send to drawing**. Expect the drawing listed first and marked *open now*, the note to land as an embeddable at the cursor, the drawing to be saved, and the embeddable to show the note's text. Close and reopen the drawing: expect the embeddable still there. Then click **Send to drawing** again and dismiss the suggester with Escape: expect no new note in the run's folder.
7d-ii. **A drawing that is not open, and one open as markdown.** Send a piece to a drawing that has no tab: expect it to open and receive the embeddable. Then open a `.excalidraw.md` with **Open as markdown** and send a piece to it: expect a proper drawing view to open and receive it, not a three-second pause and a refusal.
7e. **Without Excalidraw.** Disable the Excalidraw plugin and click **Send to drawing**. Expect one notice saying it is not installed, and no note written.
7f. **Add a chain node.** Open a drawing as its own tab and run **Chain Runner: Add chain node**. Expect the same purpose-grouped picker, a dropdown ask for a chain that declares one, and one box at the cursor holding the chain's name, its moment in grey and quoted, `audience ▾ <value>` and `▶ Run`. Expect it to move and copy as one thing. Close the drawing and reopen it: expect the node still there, still with its value.
7g. **The two links.** Ctrl/Cmd+click `▶ Run`: expect one notice saying the run arrives later, and **no** tab opened and **no** note created. Ctrl/Cmd+click the dropdown line: expect the chain's own options, and the line rewritten in place on the pick. Reopen the drawing: expect the new value still there. Copy the node, set the copy's value, and expect the original's value unchanged.
7h. **A node in an embedded drawing.** Embed the drawing in a markdown note and Ctrl/Cmd+click both links from there: expect the same two behaviours. (**Add chain node** is not expected to work there — it acts on the tab in front, and that tab is the note.)
7i. **Without Excalidraw, and on an old one.** Disable Excalidraw and run **Add chain node**: expect one notice saying it is not installed and nothing drawn. With a build older than 2.0.0, expect the version notice instead.
8. **Offline.** Stop the engine and run the command. Expect one `engine offline` notice and nothing else.
9b. **The node in both themes.** With a node on a drawing, switch light ↔ dark. Expect the title, the grey moment and the two blue links all legible in both — the node uses Excalidraw's own palette rather than Obsidian's variables, because a canvas element cannot read one, and it is Excalidraw's canvas inversion that has to carry it.
9. **Both themes.** With a finished run on screen, switch light ↔ dark. Expect every panel state legible in both: the plugin sets no colour of its own, only `--text-normal`, `--text-muted`, `--text-faint`, `--text-accent`, `--text-warning`, `--text-error`, `--background-modifier-hover` and `--background-modifier-active-hover` — the last two on a round row, hovered and selected. Check all three shapes, and the two panel actions hovered and not.

### Last recorded run

2026-09-02, against maestro-playground (Next.js 16.2.2) at `http://localhost:3000`, 14 chains in the workspace.

| Check | Result |
| --- | --- |
| `ping` (probe route) | `online` |
| `listChains` | 14 chains; `moment`, `purpose`, `parameter` came through on the chains that declare them |
| `getRun` | run `2026-07-10-xALHVU`, status `complete`, 12 outputs |
| `getLayout` | `kind: undeclared`, no panels — that chain declares no view |
| `launchRun`, chain the engine rejects | `EngineHttpError` 404, as it should be |
| `ping` at a stopped port | `false` |
| `listChains` at a stopped port | `EngineOfflineError` |
| `launchRun` against a real chain | **not run** — it spends model tokens; covered against the fake engine for every event type |
| Part two, in a vault | run 2026-09-02 in the `test_chain` vault (Excalidraw installed alongside): plugin loads, settings tab present, pill and offline notice behave. Not itemised step by step. |
| Run meta records the parameter | verified read-only, 2026-09-02: `POST /api/run` reads `paramValue` and writes `parameter: { name, value }` onto the run (`app/api/run/route.ts`), and two runs on disk carry it — e.g. `2026-09-02-jFKjsR`, `{ name: 'target audience', value: 'your mom' }`. Not re-attested by a plugin-launched run, which would spend model tokens. |
| Columns and sidebar shapes (steps 6c, 6d, 9) | **not run** — the arrangement is covered pure in `tests/arrangement.test.ts` for all three kinds, but no live run in a vault has drawn a `columns` or `sidebar` chain, and neither shape has been looked at in both themes. |
| Chain nodes on a drawing (steps 7f–7i, 9b) | **not run** — the node's shape, the click handling and the offline and version refusals are covered in `tests/chainNode.test.ts` and `tests/chainNodes.test.ts`, but no node has been placed on a live drawing. Four things only a vault can attest: that `customData` survives Excalidraw's own save and reload, that `copyViewElementsToEAforEditing` rewrites a text element rather than adding a second one, that the link hook fires on a **standalone text** element (the spike observed it only on text bound into a box — `docs/spike-ea.md`, Q1), and that the node reads correctly in both themes. |
| Part three, the quick path | run 2026-09-02 in the `test_chain` vault against a live engine — twice: once on the ported layout model, and again after the engine began streaming `layout` frames (ADR-0017). Chains ran and their results drew correctly both times. The run opened in the playground's own history from the id the result header shows (step 4). Not itemised step by step; the capability refusal (step 4b) is not separately attested. |
