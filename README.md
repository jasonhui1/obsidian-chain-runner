# Chain Runner

An Obsidian plugin that pairs vault material with [maestro-playground](https://github.com/jasonhui1/maestro-playground) insight chains.

The plugin loads, knows whether the engine is up, and can run a chain on the note in front of you — the **quick path** — reading the result in the right sidebar.

## Dependencies

- **[Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin)** (community plugin) — **required** for the drawing surface. Chain nodes, run frames, and output embeddables are all Excalidraw elements, reached through its `ExcalidrawAutomate` API. Obsidian's built-in Canvas is not used: it has no official plugin API. Nothing in this slice touches Excalidraw yet, but every later ticket does — install it before going further.
- **maestro-playground** — the engine. Runs separately, on `http://localhost:3000` by default.
- Desktop only. The plugin opens its own HTTP connections to stream a run.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Engine URL | `http://localhost:3000` | Where maestro-playground is listening. |

A URL typed without a scheme gets `http://`; a trailing slash is dropped; emptying the box restores the default. The tidied value is written back into the box, and the engine re-checked, when the field is left — not on every keystroke.

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
| **Chain Runner: List chains on the engine** | Fetches the workspace's chains and shows the count in a notice. The smoke test below uses it. |

## The quick path

**Chain Runner: Run chain on this note** takes the note you are reading — or the selection, when you have one — and runs a chain against it. Nothing is drawn; the result reads in the right sidebar.

**Picking a chain.** The picker groups chains under the four headings the engine's own picker uses: 洞見 (insight), 產出 (production), 壓力測試 (stress-test), and `unclassified` for a chain that declares no `purpose`. Under each name sits the chain's `moment` in grey — the situation that should make you reach for it — falling back to its `description`. Typing filters across every group at once, matching the name, the slug, the moment and the description; a heading with nothing left under it disappears.

Two things the picker says before you commit to a run: a chain that declares a dropdown asks for its value first, because a chain reads its parameter as an input; and a chain that declares no seed node is marked *reads its own files — this note is not used*, since it runs off the files it pins and the note you invoked it on reaches nothing.

**Reading the result.** One panel per output the chain declares, in the order it declared them, drawn in the shape it asked for:

| Chain declares | Panels |
| --- | --- |
| `view: timeline` | One per hop, last one emphasised — the surviving skeleton. |
| `view: columns` | One per branch, plus the `role: join` panel emphasised. |
| `view: sidebar` | One per loop round. |
| nothing | The run trace: one panel per node that ran, in the order it ran. |

A panel shows the section its port asked for, resolved the way the engine resolves an edge — so a panel here holds what the next hop actually received, and matches the same run opened in maestro-playground.

| Panel state | What it means |
| --- | --- |
| *writing…* | The hop is streaming; what you see is what it has written so far. |
| *waiting* | The run has not reached this hop yet. |
| *never ran* | The run settled without reaching it. |
| *nothing survived* | The hop finished and dropped the section the chain asked it for. |
| *this hop failed* | The hop errored; the engine's own message follows. |
| *skipped* | Control flow went the other way. |

**The run is the engine's.** `POST /api/run` records it like any other, so it appears in maestro-playground's history with a normal run id. The plugin keeps no second run store.

Starting a second run replaces the first — the sidebar holds one view, and the run it was showing is aborted rather than raced.

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
    client.ts           listChains / launchRun / getRun / getLayout / ping
    status.ts           the online-offline poll loop
    guard.ts            the offline guard every action goes through
  run/
    section.ts            section addressing, for scoping a half-written hop
    panels.ts             the engine's panels, plus live tokens and the trace fallback
    session.ts            the event fold, and the result the view renders
    seed.ts               what a note contributes to a run
  ui/
    pickerModel.ts        the picker's groups and order
    chainPicker.ts        the chain and parameter modals
    panelCopy.ts          what a panel says when it has nothing to show
    throttle.ts           how often the result view redraws
    resultView.ts         the right-sidebar view
    quickRun.ts           the command: note → picker → stream → view
    settingsTab.ts, statusPill.ts
```

`src/run/` holds no Obsidian import: what a stream of engine events means, and what panels it becomes, is decided there and checked without a vault. The view is left with the two things only a view can do — markdown, and how often to redraw.

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
6. **A chain with a dropdown.** Pick one that declares a `parameter`. Expect a second modal asking for it before the run, and the value in the result header.
6b. **A chain that pins its own files.** One with no `seed` node should carry the *reads its own files* line in the picker.
7. **A chain declaring no view.** Expect the run trace fallback and a line saying so, not an empty view.
8. **Offline.** Stop the engine and run the command. Expect one `engine offline` notice and nothing else.
9. **Both themes.** With a finished run on screen, switch light ↔ dark. Expect every panel state legible in both: the plugin sets no colour of its own, only `--text-normal`, `--text-muted`, `--text-faint`, `--text-accent`, `--text-warning` and `--text-error`.

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
| Part three, the quick path | run 2026-09-02 in the `test_chain` vault against a live engine — twice: once on the ported layout model, and again after the engine began streaming `layout` frames (ADR-0017). Chains ran and their results drew correctly both times. The run opened in the playground's own history from the id the result header shows (step 4). Not itemised step by step; the capability refusal (step 4b) is not separately attested. |
