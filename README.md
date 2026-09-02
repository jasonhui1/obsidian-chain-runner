# Chain Runner

An Obsidian plugin that pairs vault material with [maestro-playground](https://github.com/jasonhui1/maestro-playground) insight chains.

This first slice is the floor everything else stands on: the plugin loads, it knows whether the engine is up, and it can talk to it.

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
| **Chain Runner: List chains on the engine** | Fetches the workspace's chains and shows the count in a notice. The smoke test below uses it. |

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
  ui/
    settingsTab.ts, statusPill.ts
```

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
| Part two, in a vault | **not yet run** |
