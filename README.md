# Chain Runner

An Obsidian plugin that pairs vault material with [maestro-playground](https://github.com/jasonhui1/maestro-playground) insight chains.

The plugin loads, knows whether the engine is up, and can run a chain on the note in front of you — the **quick path** — reading the result in the right sidebar. It can also put a **chain node** on an Excalidraw drawing: a box naming the chain, with its dropdown, run-count picker and `▶ Run` link.

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
| a spinner, `…` | The first check has not answered yet. |
| a link, `engine` | The engine answered. |
| a broken link, `offline` | Nothing is listening at the engine URL. |

The icon is lucide and the word is plain text, so the pill is the theme's to
colour and looks like Obsidian's own status items rather than like a plugin's.

An engine that answers with an *error* is still online — a broken workspace is not a stopped server.

The poll asks for `/api/runs/chain-runner-probe`, a run id nothing matches, because the engine answers it from one failed file read. `/api/workspace` would also answer, but it reads and serialises the whole workspace off disk — too much to repeat every three seconds.

Any plugin action taken while the engine is offline shows a `The engine is offline` notice and does nothing else.

## Commands

| Command | What it does |
| --- | --- |
| **Chain Runner: Run chain on this note** | The quick path, below. |
| **Chain Runner: Mark lines to keep in this note** | Keep-marks over the note in front of you, below. |
| **Chain Runner: Add chain node** | Puts a chain node on the Excalidraw drawing in front of you. |
| **Chain Runner: Expand this block with a chain** | Asks a chain for branches off the block you have selected, below. |
| **Chain Runner: Keep the selected proposal** | Turns the selected proposal into ordinary material. |
| **Chain Runner: Drop the selected proposal** | Takes the selected proposal off the drawing and trashes its note. |
| **Chain Runner: List chains on the engine** | Fetches the workspace's chains and shows the count in a notice. The smoke test below uses it. |

## The quick path

**Chain Runner: Run chain on this note** takes the note you are reading — or the selection, when you have one — and runs a chain against it. Nothing is drawn; the result reads in the right sidebar.

**What the run reads.** The note and the selection are read from one pane — the editor you are in — so a selection left behind in another pane can never be run under a different note's name. With nothing selected the whole note is the seed, minus its frontmatter: tags, aliases and dates are the vault's bookkeeping, not part of the argument the chain is asked to read. Select a passage and that passage is the seed instead, left exactly as it was highlighted — frontmatter inside a selection was selected on purpose. The result header names the note when it supplied the seed, and adds `(selection)` when the run covered less than it: `seed: premise.md (selection)`.

**Choosing the seed.** Once a seeded chain's parameter is set, the quick path offers the current note or selection as a rough hint, or **Start with no hint**. The hint choice sends the same text as before. With no usable text, the chain picker still opens and the run starts with an empty `seedPrompt` without another prompt. The result says `seed: no hint`; when a source note exists, its path still resolves links in rendered panels. A chain that declares no seed continues directly, since it reads its own files.

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

**A view with no panels is still a designed view.** The sidebar never shows a
blank pane or a bare sentence; it says which of five situations it is in, and
what to do about it:

| Situation | The view says |
| --- | --- |
| Nothing run yet, engine up | **No run yet** — and names the command. |
| Nothing run yet, engine down | **No engine** — and names the URL it looked at, in red. |
| Launched, no panel landed yet | **Waiting for the first hop** — breathing while it waits. |
| Failed before any hop wrote | **The run landed nothing**, in red; the reason is in the header above. |
| Finished holding nothing | **The run landed nothing**. |

Only the first two read the engine — a run that has been launched says what
happened to *it*, whatever the engine is doing now. So stopping the engine turns
an *idle* sidebar into the offline state without a run being attempted, and
changing the engine URL in settings re-reads it, while a run already on screen is
left alone. Which of the five it is lives in
`src/ui/emptyState.ts` and is checked in `tests/emptyState.test.ts`; the view
only draws it.

**Motion says what is still happening, and nothing else.** Anything in flight —
the `running` status, a `writing…` panel, the pill before its first answer —
breathes; hover and focus transition. There are no one-shot cues, because the
result view rebuilds its contents on every draw — ADR-0006 has the reasoning and
#16 is the fix. All of it is off under `prefers-reduced-motion: reduce`. Every
*transition* duration and easing is Obsidian's own `--anim-*`, with a fallback so
a theme that has dropped the variable loses the motion rather than the rule; the
pulse's own period is a literal, for the reason the ADR gives. Nothing pulses
that does not also say what it is in words, so a reader who turns motion off, or
cannot perceive it, loses nothing.

**The keyboard reaches everything the mouse does.** A round row in a sidebar
layout is focusable and answers `Enter` and `Space`, the list is a `listbox` and
each row an `option` carrying `aria-selected`; the three panel actions are real
buttons and draw a focus ring of their own, since they have no chrome to borrow
one from.

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

### Keep-marks

**Keep lines**, the third action on a panel, and **Chain Runner: Mark lines to keep in this note** open the same surface: every line of the text, marked by clicking it or by moving with `↑` `↓` and pressing space. Marked lines are highlighted. `Enter`, or **Done**, ends the marking; `Escape` drops it.

**Marks belong to the session, not to the note.** Nothing is written while marking, and closing the modal takes the marks with it.

**Where they go is asked once, at the end** — the marks are made before there is anywhere to put them:

- **Keep as a trimmed note.** Marked lines off a panel are still that run's output, so they are written as an output note by the convention above, named `<output> (kept).md`, run and chain frontmatter intact. Marked lines off a note are written beside it as `<note> (kept).md`, with `kept from: "[[<note>]]"` for its provenance. Either way a collision gets a suffix, and a note already saying exactly this is reused.
- **Run a chain on the marked lines.** The chain picker opens, and the run is seeded with the marked lines rather than the whole note. The result view names it `seed: <note> (kept lines)`.

Lines marked next to each other read as one passage; passages that were apart are separated by a blank line, which is a paragraph break to every chain. Marking nothing keeps nothing, and says so. The whole rule is `src/run/keepMarks.ts`, checked in `tests/keepMarks.test.ts` without a vault.

**The run is the engine's.** `POST /api/run` records it like any other, so it appears in maestro-playground's history with a normal run id. The plugin keeps no second run store.

Starting a second run replaces the first — the sidebar holds one view, and the run it was showing is aborted rather than raced.

## Chain nodes on a drawing

**Chain Runner: Add chain node** puts one chain on the drawing you are looking at:

```
╭────────────────────────────╮
│ ⛓ Five Personas ▾          │
│ when a premise feels safe  │
│ audience ▾ engineers       │
│                    ▶ Run   │
╰────────────────────────────╯
```

The picker is the quick path's, with the same four purpose headings and the same grey `moment` under each name — only the question differs, and a chain that reads no seed is marked *reads its own files — bound inputs are not used*. A chain declaring a dropdown asks for its value **before** the node is placed: the alternative is a node that arrives reading `audience ▾ unset` and needs a second interaction before it means anything. The node lands **at the cursor**, grouped, and the drawing is saved.

**Drag a node wider and it shows more of its words.** A line too long for the box is trimmed with an ellipsis rather than wrapped, but the box is no longer a fixed 300px: when you finish dragging, every line is cut again to the width you left it at, and the box closes up around them. Drag it narrower and the lines shorten again. The type size is put back to what the node was designed at each time, so a bigger box gives you *more words*, not *bigger words* (ADR-0011).

The words it recovers come from the node itself — the chain's name and its dropdown are stamped on every element, and the moment is kept alongside them. A node drawn before this keeps working; it just has nothing extra to reveal.

The re-cut happens when you let go, not while you drag, because every write to a drawing is a save. A drag that only moves a node writes nothing, and neither does an ordinary click.

A line too long for the box is trimmed with an ellipsis rather than wrapped. Excalidraw wraps to the width it is given, and a wrapped line would push the ones under it out through the bottom — a chain with a two-sentence moment would stop being one box. The box is a label; the full text is a click away in the picker.

**Four linked controls, and none opens anything outside the plugin.** `⛓ Five Personas ▾` re-opens the chain picker and re-shapes the node around what you pick; `audience ▾ engineers` re-asks the chain's own options and rewrites the value where it stands; the count opens its run-count picker and rewrites the chosen count; `▶ Run` runs the node. Every element of a node swallows its click, so a node that has been copied or half-deleted can never open a browser tab or make a note in the vault. Following a link on an Excalidraw canvas is **Ctrl/Cmd+click** (or the element's link icon), and all four controls answer to it.

**The three picker controls share the same click behavior.** A plain click opens a picker when Excalidraw reports the individual line; on a grouped node the first click selects the group, and the drill-in click names the line. This applies to `⛓ Five Personas ▾`, `audience ▾ engineers` and the count control. Excalidraw reports a click only as a change of selection, so Chain Runner waits for the pointer to come back up before opening anything, because **dragging** the node begins with exactly the same event (ADR-0010). Selecting several, dragging, holding, selecting from the keyboard, or a redraw of the scene opens nothing. `▶ Run` is deliberately **not** on the single click: selecting a node is not asking to run it, and a run cannot be taken back where a picker can be dismissed. **Double-click it instead** — two clicks are a deliberate gesture in a way one selection is not. Ctrl/Cmd+click still starts a run too.

One limit worth knowing: clicking a line that is **already selected** changes nothing on the drawing, so Excalidraw reports nothing and the picker does not open. Click away and back, or Ctrl/Cmd+click.

**The picker opens where you clicked.** It appears just below and right of the press, flipping and clamping so it never leaves the window, and the drawing stays visible behind it rather than dimmed. The picker the command palette opens stays centre-screen, since that click was on the palette.

**Changing the chain.** A different chain declares a different moment and a different dropdown, so the chain line is not the only thing that changes: the grey line is rewritten, and the parameter line is rebuilt — it appears, changes or disappears, and the box closes up or opens out around it. The **box is kept** through all of that, because arrows bind to element ids and redrawing the node would drop every input bound into it; only the lines inside it are added and removed. A new line claims the node's group and frame itself, so the node still moves and copies as one thing.

**Getting to a node without the palette.** Chain Runner writes an Excalidraw **script** into the vault's script folder — `Excalidraw/Scripts/Add chain node.md`, with its icon beside it — every time it loads, and only when the words differ. Reach it through the gem in the canvas's top-right: a tap on **Add chain node** drops a node with no chain at all, and a 1.5-second press **pins** it as a button beside the gem. After that the palette is out of the flow: press the button, a blank node lands at the cursor, and you pick its chain on the node itself. Excalidraw's shape strip is its own React component and cannot be added to; the script engine is the way onto the canvas (`docs/agents/excalidraw.md`).

A node with no chain reads `⛓ pick a chain ▾` and holds nothing else but `▶ Run`, which says which line to click rather than running anything. Excalidraw registers every script as a command of its own — **(Script) Add chain node** — so the palette route exists without this plugin adding one.

A node placed before the chain line was clickable keeps working: it still runs, and picking a new chain still re-shapes it. Its own top line carries no link, though, so it is not clickable until the node is replaced (ADR-0009).

**What the drawing stores.** Each of the node's elements carries the same stamp in Excalidraw's `customData`: which node it belongs to, which part of the node it is, the chain's slug and name, and the parameter's name and value. `customData` survives moving, copying and a file reload, so a node keeps working across all three, and a value set on it is still there after Obsidian restarts. Copying a node copies the stamp too, so both copies claim one id — Excalidraw re-makes the *group* on copy, and that is what keeps a rewritten parameter on the copy you clicked.

**Colours are Excalidraw's, not Obsidian's.** A canvas element cannot read a CSS variable, and Excalidraw inverts its whole canvas in dark mode — so the node uses that palette's own ink, grey and blue, and reads correctly in both themes because the canvas, not the plugin, does the flipping. Everything else in the plugin still uses Obsidian's variables.

**Where it works.** Adding a node needs the drawing **open as its own tab**: the command acts on the tab in front of you, and a drawing embedded in a markdown note is a markdown tab. Clicks on a node work in both: the spike found the link hook fires inside an embedded drawing exactly as it does in a standalone one (`docs/spike-ea.md`, Q4), and the hook hands over the view the click happened in — which is the only handle on an embedded drawing, since it is not a tab that can be looked up. The spike exercised one embedded context without differentiating Reading view from Live Preview, so that much is unattested.

One shape the spike did not exercise: it observed the hook on text **bound into a box**, and noted that a plain-rect control was not tried. A node's links sit on standalone text elements, so the observation is one step away from what ships — the first thing to check if a click ever falls through.

Excalidraw 2.0.0 or newer is required, and the version is checked before anything is placed — an older one says so in a notice and nothing is drawn.

### Where an output came from

Every output note says which run wrote it. The frontmatter carries `run`, `chain` and `output`, and a `source` link to the run on the engine as it was addressed at the time; above every *rendering* of the note — inside an embeddable on a drawing as much as in the note's own tab — sits one faint line reading **source run**, linking to the engine's view of that run.

That line is rendered rather than stored, and built from the engine URL set *now* (ADR-0004). Moving the engine to another port or machine moves every header with it; the `source` key in the file is for readers outside this plugin and is never read back. It also keeps the provenance out of the note's own text, which matters for the next paragraph.

**An output is material.** Arrow an output's embeddable into another chain node and it is an ordinary note input: the second run reads the hop's words, with the frontmatter stripped the way any bound note's is, and lands in a frame of its own titled with its own run id. Both runs are in the engine's history; neither knows about the other.

**A run that is gone reads as gone.** The header asks the engine whether the run is still there. An engine that answers and has no such run turns the line into **source run deleted**, in amber; an engine that cannot be reached leaves the link alone, because an engine that is down is not a run that was deleted. Nothing throws either way, and the answer is remembered per run so a note being written line by line does not ask once per repaint.

**A rerun is followed on the card.** While a rerun goes (⟳ Rerun downstream, or *Use this reply as the revision & rerun*), each card it writes again shows the step under its source-run line — `⟳ Writing a new verdict…` — over its old words, greyed. A card the rerun only replays is left alone. The line is rendered, not stored, so a rerun that fails leaves nothing to undo. When it lands, every drawing **open at that moment** has its cards pointed at notes filed under the new run, and its frame's title and `✎ Direct` label name that run; the old run's notes stay as they were, its record. A drawing that was not open keeps the old run's cards, and a click on one still finds the hold where it now lives.

## Expand a block

Select one text block or embedded note on a drawing and run **Expand this block with a chain**. The chain picker opens — Expand names no chain of its own, and none had to be written on the engine for it to work (ADR-0005). The pick runs seeded from that block alone, and every output it declares lands as a card beside it.

**A proposal looks unfinished, because it is.** Each card is grey and dashed, with a dashed connector back to the block it came from, and `✓ Keep` / `✕ Drop` beneath it. Nothing else on a drawing is drawn that way, so a proposal cannot be mistaken for something you decided to keep.

**A proposal is an ordinary output note.** It fills in place as the run streams, is filed under the run that wrote it, and carries the same `run`, `chain` and `output` frontmatter and the same **source run** header as any other output. That is what makes keeping one a matter of style rather than of substance: an accepted proposal is already the thing it becomes.

**Keeping restores the drawing's ink; dropping takes the note with it.** `✓ Keep` turns the card and its connector solid, drops both labels, and leaves nothing on the element saying it was ever a proposal — another plugin's `customData` on the same element is left alone. `✕ Drop` removes the card, its connector and its labels, and *then* trashes the note: the other order would leave an embeddable pointing at nothing. It goes to the trash rather than being erased, so your own deletion setting decides how final that is.

**Two routes to each decision.** Following a link on a canvas needs Ctrl/Cmd+click (`docs/spike-ea.md`, Q1), so the two labels are not a one-click affordance on their own. Select a proposal and the same two decisions are in the palette, where no modifier is needed. The labels are where the decision is; the commands are the one-action path.

**What Expand will not read.** A selection of anything but one block, a chain node (furniture, not material), a picture with no words in it, and a block that says nothing — each is one notice and nothing drawn. A note inserted with Excalidraw's own **Insert file from vault** is drawn as an image rather than an embeddable; the note behind it is read all the same, and its frontmatter is stripped the way any bound note's is.

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
    emptyState.ts         what the result view says when it has no panels at all
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
2. **Status bar, online.** The pill should read a link icon and `engine` within a few seconds of the vault opening. Hovering it shows the engine URL.
3. **Status bar, offline.** Stop the engine (Ctrl-C). The pill flips to a broken-link icon and `offline` within a few seconds. Start it again; it flips back within a few seconds.
4. **Offline action.** With the engine stopped, run **Chain Runner: List chains on the engine** from the command palette. Expect exactly one notice, `The engine is offline`, and nothing else.
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
7f. **Add a chain node.** Open a drawing as its own tab and run **Chain Runner: Add chain node**. Expect the same purpose-grouped picker, a dropdown ask for a chain that declares one, and one box at the cursor holding the chain's name, its moment in grey and quoted, `audience ▾ <value>`, `▶ Run` and a count box showing `1`. Open the count picker and expect quick choices `1` through `5` plus a focused number field. Type a valid count and press Enter or **Set count**; expect it to appear in the box. Expect the node to move and copy as one thing, with each copy keeping its own count. Close and reopen the drawing: expect the node still there, still with its value and count.
7g. **The node controls.** Ctrl/Cmd+click `▶ Run`: expect a run using the count shown in the box beside it, with no count picker and no tab opened by the link itself. Ctrl/Cmd+click the count: expect its picker, and the chosen count rewritten in place. Ctrl/Cmd+click the dropdown line: expect the chain's own options, and the line rewritten in place on the pick. Reopen the drawing: expect the new value still there. Copy the node, change the copy's count, and expect the original's count unchanged.
7h. **A node in an embedded drawing.** Embed the drawing in a markdown note and Ctrl/Cmd+click all three controls from there: expect the same behaviours. (**Add chain node** is not expected to work there — it acts on the tab in front, and that tab is the note.)
7i. **Without Excalidraw, and on an old one.** Disable Excalidraw and run **Add chain node**: expect one notice saying it is not installed and nothing drawn. With a build older than 2.0.0, expect the version notice instead.
7q. **The chain line.** Start a run on a node and Ctrl/Cmd+click its chain line while it is going: expect one notice saying to wait, and no picker. Then, on a settled node, Ctrl/Cmd+click `⛓ <chain> ▾` on a placed node and pick a different chain. Expect the name rewritten, the grey moment rewritten to the new chain's, and the parameter line rebuilt — present with the value you were asked for when the new chain declares a dropdown, and **gone** when it does not, with the box closing up around it. Expect any arrow drawn into the node still bound after the change, and the node still moving and copying as one thing. Reopen the drawing: expect what you picked still there. Copy the node, change the copy's chain, and expect the original unchanged.

7r. **The toolbar button.** With Excalidraw open, check `Excalidraw/Scripts/Add chain node.md` and `.svg` exist in the vault. Open the Obsidian Tools Panel from the gem in the canvas's top-right: expect **Add chain node** there with a chain-link icon, **not** a cog. Tap it: expect a node at the cursor reading `⛓ pick a chain ▾`, `▶ Run` and a count box showing `1`, with no picker. Ctrl/Cmd+click its `▶ Run`: expect one notice saying to pick a chain, and no run. Press the panel's button for 1.5 seconds: expect the toast `Pinned: Add chain node` and a button beside the gem that places a node in one click. Do the same from a drawing embedded in a note. Then edit the script file, reload the plugin, and expect it put back. Finally disable Excalidraw, reload, and expect **no** script folder made.

7s. **A plain click.** On a settled node, click `⛓ <chain> ▾` once, no modifier: expect the chain picker beside the pointer, the drawing still visible behind it, and picking a chain to re-shape the node exactly as Ctrl/Cmd+click does. Same on `audience ▾ <value>`. Click `▶ Run` once: expect **nothing** — no run, no picker. Double-click it **from an empty canvas, with nothing selected** — expect one run using the count shown beside Run, with no count picker. Excalidraw's own text editor may open on that line at the same time — that is the very thing the run is detected by — so press Escape and expect its words unchanged. Double-click it again while the run is going: expect no second run. Rubber-band the whole node and double-click it: expect no run. Rubber-band the whole node, and press Ctrl+A: expect no picker either time. Arrow-key or Tab to a node's chain line if Excalidraw lets you: expect **no** picker at all — there was no press. Now press on the chain line and drag the node somewhere: expect it to move and **no** picker. Press and hold on it for a second without moving, then release: expect no picker either. Click a chain line, dismiss the picker, and click the same line again: expect nothing, and Ctrl/Cmd+click to still work. Then check the chain line, dropdown and count control **all still open their pickers on a double-click** — a node is a group, so that is the gesture that reaches each of its lines, and a run must not be the only action it reaches. Do all of it in a drawing embedded in a note. Then drag a node's corner handle wider: expect the words to hold their size and **more of the chain name and the moment to appear**, the box closing up around the lines. Drag it narrower: expect them to shorten again with an ellipsis. Drag a node without resizing it, and click one without dragging: expect the drawing **not** to be saved either time (watch the file's modified time). Drag one node in a drawing that holds three: expect the other two untouched. Resize a node mid-run: expect `▶ Run`'s own words — the progress — left alone. Reopen the drawing and expect the new width still there.

7t. **Re-cutting a resized node.** Covered by the last four sentences of 7s; run them with a chain whose name and moment are both far too long for one line, so there is something to reveal.

7u. **Repeated runs from a node (#71).** With an engine advertising `varianceGroups`, choose `3` from the count picker beside `▶ Run`, then Ctrl/Cmd+click `▶ Run`. Expect one request using the node's current bound inputs and dropdown value, then three output frames with distinct run ids stacked beside the node. Each frame should have its own output notes, fill as that member runs, and stay separate after saving and reopening the drawing. Enter a custom count on a copied node and expect the original to keep its value. An older node in a drawing embedded in a note should get its count picker when it is first run. With `varianceGroups` false or absent, count `1` should run once; a count greater than `1` should show a capability notice and make no request.

7j. **Where an output came from.** Run a node and open one of its output notes. Expect `source` in the frontmatter pointing at `<engine>/history/<runId>`, and one faint **source run** line above the note's words — in the note's own tab *and* in the embeddable on the drawing. Ctrl/Cmd+click it: expect the playground's own view of that run.
7k. **An output run again.** Arrow one output's embeddable into a second chain node and run it. Expect the second run to be seeded with that output's words and nothing else — no frontmatter, no `source run` line — a second frame titled with its own run id, and both runs in the playground's history.
7l. **A run that is gone.** Delete that run from the engine's history and reopen the drawing. Expect the line to read **source run deleted** in amber, with no link and no notice. Then stop the engine and reopen it: expect the line to stay a link, because an engine that is down is not a run that was deleted.
7m. **Keep-marks.** With a finished run on screen, click **Keep lines** on a filled panel. Mark a few lines by clicking them and a few more with ↑ ↓ and space; expect each marked line highlighted and the row under the keyboard marked down its edge. Press Enter, choose **Keep as a trimmed note**, and expect `<output> (kept).md` beside the panel's own note, the run and chain frontmatter intact, and only the marked lines in it — lines marked next to each other in one block, blocks that were apart separated by a blank line, and any indented line still indented. Then run **Chain Runner: Mark lines to keep in this note** on a note with frontmatter: expect the frontmatter not offered as lines, and, on choosing **Run a chain on the marked lines**, the chain picker followed by a run whose header reads `seed: <note>.md (kept lines)`. Close the modal with Escape and reopen it: expect no marks remembered and nothing written to the note.
7n. **Expand a block.** Draw a text block on a drawing, select it, and run **Chain Runner: Expand this block with a chain**. Expect the chain picker — Expand names no chain of its own (ADR-0005). Pick `write-the-opposite` (two outputs, so two cards). Expect one greyed, dashed card per declared output in a column to the right of the block, each connected back to it by a dashed arrow, each filling with its hop's words as the run goes, and `✓ Keep` / `✕ Drop` under each. Expect the cards to read as clearly unfinished beside anything already on the drawing.

7o. **Keep and drop.** Ctrl/Cmd+click `✓ Keep` on one card: expect its stroke and its arrow to go solid black, both labels to vanish, and the note to stay in `chains/runs/<runId>/`. Ctrl/Cmd+click `✕ Drop` on another: expect the card, its arrow and its labels all gone, and the note in the trash. Then select a third card and use the palette — **Keep the selected proposal** and **Drop the selected proposal** — and expect the same two outcomes with no modifier key. Reopen the drawing: expect a kept card still solid and still showing its note, and no trace of the dropped ones.

7p. **What Expand refuses.** Run the command with nothing selected, and with two things selected: expect one notice asking for a single block, and no picker. Select an embeddable showing a note and expand it: expect the note's body to be the seed, minus its frontmatter. Select a chain node and expand it: expect the same refusal — a node is not material. Stop the engine and run it: expect one `The engine is offline` notice and nothing drawn.

8. **Offline.** Stop the engine and run the command. Expect one `The engine is offline` notice and nothing else.
9b. **The node in both themes.** With a node on a drawing, switch light ↔ dark. Expect the title, the grey moment and the two blue links all legible in both — the node uses Excalidraw's own palette rather than Obsidian's variables, because a canvas element cannot read one, and it is Excalidraw's canvas inversion that has to carry it.
9. **Both themes.** With a finished run on screen, switch light ↔ dark. Expect every panel state legible in both: the plugin sets no colour of its own, only `--text-normal`, `--text-muted`, `--text-faint`, `--text-accent`, `--text-warning`, `--text-error`, `--background-modifier-hover` and `--background-modifier-active-hover` — the last two on a round row, hovered and selected. Check all three shapes, and the two panel actions hovered and not.

### Part four — the polish pass, by hand

Everything above checks that a surface *works*. This checks that it *looks like
Obsidian*, which only a vault can answer. Run it in light and dark, and under
two community themes as well as the default — a theme that redefines the
variables is the real test of using them.

1. **The five empty states.** With no run on screen, expect **No run yet** and
   the command named. Stop the engine and, without touching the sidebar, expect
   it to turn into **No engine** naming the URL. Point the engine URL at a dead
   port in settings and expect the same, with the new URL. Then launch a run and
   expect **Waiting for the first hop**, breathing, until the first panel lands.
2. **Motion.** Watch a run: expect the `running` status and each `writing…`
   panel to breathe, and nothing else to move. Turn on **Reduce motion** in the
   OS and expect all of it to stop dead with the colours unchanged.
3. **The keyboard.** In a sidebar-layout run, Tab to a round row: expect a focus
   ring, and `Enter` or `Space` to open it. Tab to a panel's actions: expect a
   ring on each of the three, and `Enter` to fire it.
4. **The status pill.** Expect a lucide icon and a plain word, sitting among
   Obsidian's own status items without standing out as a plugin's — and
   following the theme's status-bar colour, not a colour of its own.
5. **Every surface, both themes, three themes.** Walk the picker, all three
   result shapes, a chain node, a run frame, the output embeddables, the source
   run header, the status pill, the keep-marks modal, and each empty and failed
   state. That nothing carries a colour or font of its own is already checked by
   reading (see the table below); what only eyes can answer is whether each one
   *reads* right — contrast, weight, spacing, and what the eye reaches first.
   Screenshot each, before and after.

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
| Chain nodes on a drawing (steps 7f–7i, 9b) | **partly run** — the live chain-picker and plain-click checks below placed and exercised nodes, and step 9b was checked in both themes during the expand pass. The full 7f–7i/9b pass has not been run as a whole. Still to attest in a vault: that a text rewrite made by `copyViewElementsToEAforEditing` persists without adding a second element, and that the link hook fires on a **standalone text** element (the spike observed it only on text bound into a box — `docs/spike-ea.md`, Q1). Node shape, click handling, and offline and version refusals are also covered in `tests/chainNode.test.ts` and `tests/chainNodes.test.ts`. |
| Repeated runs from a node (step 7u, #71) | **not verified in Excalidraw.** `tests/nodeRun.test.ts` covers the stored run-count value, the node's bound inputs and parameter, separate member streams and output frames. One authorized `creative-director` two-run request reached a human hold in both runs; the temporary harness timed out before confirming note or frame placement and used an in-memory note store, so it did not test vault writes. A live Excalidraw pass still needs to attest that the frames remain readable and separate after save and reload. |
| Waiting hold column (#74) | **User vault check, 2026-09-24.** A screenshot showed two separate waiting columns with long candidate text, and the user confirmed the columns survive closing and reopening the drawing. The seven placeholder cards visible in the screenshot belonged to a run still responding; the user confirmed they turn into a hold column when that response finishes. The directing side panel was shown with the candidate click. The saved `customData` was not inspected separately; the reopened column and working click are the live evidence. Pure layout, stamps, run flow and candidate clicks are also covered in `tests/holdColumn.test.ts`, `tests/nodeRun.test.ts` and `tests/directFromDrawing.test.ts`. |
| Expand (steps 7n-7p) | run 2026-09-04 in the `test_chain` vault against a live engine on Excalidraw 2.26.4. All of 7n-7p pass. The three unverified EA calls all hold: `addArrow` binds a connector to both ends, `getViewSelectedElements` returns the selection, and `isDeleted` on a copied element removes it. Both decision routes work — the labels under Ctrl/Cmd+click, and the two palette commands on a selected card. Checked in both themes: the dashes survive Excalidraw's canvas inversion on card borders and connectors alike, and a proposal differs from accepted material structurally as well as by colour — dashed with two labels under it, against solid with none — so the distinction does not rest on the inversion being kind to grey. Step 9b (the node in both themes) was attested in the same pass. A vault found two things the tests could not: cards were spaced 24px apart while a card's labels reach 30px below it, so every card but the last had its labels on its neighbour; and **Insert file from vault** draws a note as an *image* element, which `blockInput` could not read, so expanding one was refused. Both fixed, and the spacing is now derived from the labels' own reach with a test that fails if it drifts. |
| The chain dropdown and the toolbar button (steps 7q, 7r) | Partly run, 2026-09-04, `test_chain` vault on Excalidraw 2.26.4. Excalidraw picks up a script this plugin writes, icon and all. Picking a chain on the node rewrites the name, the moment and the parameter line, and the node reads correctly afterwards. **A vault found two things every test missed, both of which made the node unreadable.** `draw()` computed a `fontSize` per line and never passed it to Excalidraw, so every line drew at EA's default while the box height and line spacing were computed for 20px/16px — four lines piled on top of each other. And a text element holds its words in **three** places: setting `text` and `originalText` but not `rawText` loses the rewrite the moment the drawing saves, because Excalidraw writes its own `textElements` map into the markdown and re-parses from it. That one silently affected the parameter line and the `▶ Run` status too; no earlier pass had exercised a text change. Both fixed and written into `docs/agents/excalidraw.md`. **Still not attested:** pinning the button, and whether an arrow bound into a node survives the box being resized by a chain change. |
| Re-cutting a resized node (step 7t) | **Run 2026-09-05, `test_chain` vault on Excalidraw 2.26.4 — passing.** Dragging a node wider reveals more of its chain name and moment, and the type size holds rather than scaling. Confirmed the re-cut lands **on release**, which is the design (ADR-0011): every write to a drawing is a save, so re-cutting per drag frame would save per frame. **The `laidOut` guard is attested**: the drawing's modified time was watched across two sessions of clicking a node and the canvas around it, and every save in them was accounted for by something the reader actually changed. Clicking alone writes nothing. **Still not attested:** that a drawing holding several nodes leaves the others untouched when one is resized, and whether a re-cut line sitting short of the box's edge reads as wrong, since `GLYPH_WIDTH` estimates the font rather than measuring it. |
| A plain click on a node (step 7s) | **Run 2026-09-05, `test_chain` vault on Excalidraw 2.26.4 — passing.** A plain click opens the picker, it opens beside the node with the drawing visible behind it, and a double-click on `▶ Run` starts a run on the second click. Ctrl/Cmd+click still works. **Four defects a vault found and every test missed, all the same mistake — assuming something about a click is knowable at the moment it happens.** (1) The scene hook is raised through React's `onChange`, so the report lands *after* `pointerup`; a gate that only queued callers while a press was in flight settled every click as "not a click". (2) Asking the drawing what is selected returns nothing once Excalidraw opens its text editor on a double-clicked element. (3) The browser's `dblclick` **never fires over the canvas** — Excalidraw captures the pointer and the compatibility mouse events go with it. (4) A node is a **group**: the first click selects all five elements and names no line, and only a double-click drills into one, reported a beat later. The double now arms a window and acts on that report. All four are in `docs/agents/excalidraw.md`. **A fifth defect, found after the four above were fixed:** making the double-click act on the drill-in report consumed it, and on a grouped node that report is how *every* line is named — so the chain picker and the dropdown silently stopped opening. The run now takes it only for `▶ Run`. All three existing actions were re-checked together and passed at that time. The run-count picker added later has adapter and handler tests, but has not been verified in a live vault. **Still not attested:** whether the 4px/700ms click thresholds and the 450ms double window feel right under other hands, and what Excalidraw's text editor opening on `▶ Run` looks like to a reader who did not expect it. |
| Keep-marks (step 7m) | **not run** — what the marks mean is covered pure in `tests/keepMarks.test.ts` and where they go in `tests/keepMarksActions.test.ts`, but no marking has been done in a vault. One thing only a vault can attest: that the modal's scope bindings (↑ ↓, space, Enter) do not fight Obsidian's own. The marked-line contrast risk (#17) is fixed — it now pairs `--text-selection` with `--text-normal`, a combination Obsidian's own themes guarantee rather than the semi-transparent `--text-highlight-bg`. |
| Part four, the polish pass | **partly run — nothing in a vault.** What was checked, and how: **by reading, and it holds** — no surface carries a colour or font of its own. `styles.css` holds no hex, `rgb()`, `hsl()` or colour keyword, and its one `font-family` is `var(--font-monospace)`; no module sets `cssText` or injects a `<style>` tag; every rule resolves through Obsidian's variables, and the three added since (`--anim-duration-fast`, `--anim-motion-smooth`, `--background-modifier-border-focus`) carry fallbacks. That covers the picker, all three result shapes, the empty and failed states, the source-run header, the keep-marks modal and the status pill. Two modules write inline styles, both deliberately and neither a colour: `src/ui/anchorModal.ts` writes the spot and size an anchored picker opens at, which is a position no stylesheet can know (ADR-0010). The chain node and the run frame are Excalidraw's canvas, where `src/ui/ink.ts` is the one deliberate colour exception and stays one — a canvas element cannot read a CSS variable, so the node uses Excalidraw's own palette and its canvas inversion carries dark mode. **Fixed in the same pass:** five designed empty states, motion under `prefers-reduced-motion` (ADR-0006), focus rings and keyboard-reachable round rows, the status pill's emoji replaced by a lucide icon, and the two lowercase notices put in sentence case. **Not attested, and only a vault can:** every step of Part four above — that each surface *reads* right in light and dark under two community themes, which is a judgement no audit makes. Tracked as #18. Remaining nit is #16. |
| A rerun on the drawing (#45) | **not run** — which cards a rerun writes again, the ⟳ line, and what a landing changes on a scene are covered in `tests/rerunWatch.test.ts`, `tests/sourceRunHeader.test.ts`, `tests/runLabel.test.ts` and `tests/rerunOnDrawing.test.ts`. Only a vault can attest: that an embeddable re-pointed by rewriting its `link` shows the new note, that a frame renamed through `name` keeps its title after a save, and that the greyed card reads right in both themes. |
| Part three, the quick path | run 2026-09-02 in the `test_chain` vault against a live engine — twice: once on the ported layout model, and again after the engine began streaming `layout` frames (ADR-0017). Chains ran and their results drew correctly both times. The run opened in the playground's own history from the id the result header shows (step 4). Not itemised step by step; the capability refusal (step 4b) is not separately attested. |
