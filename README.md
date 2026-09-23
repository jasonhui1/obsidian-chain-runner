# Chain Runner

Chain Runner runs [maestro-playground](https://github.com/jasonhui1/maestro-playground) chains on
notes in Obsidian. Read a result in the right sidebar, or work with chain nodes and output cards on
an Excalidraw drawing. The engine runs separately and records each run.

## Set up

1. Install Obsidian 1.7.2 or newer on desktop.
2. Set up and start maestro-playground with at least one chain. Its default address is
   `http://localhost:3000`.
3. Install and enable the
   [Excalidraw community plugin](https://github.com/zsviczian/obsidian-excalidraw-plugin)
   (2.0.0 or newer) if you want the drawing workflow. Obsidian's built-in Canvas is not supported;
   note runs work without Excalidraw.
4. Build Chain Runner from this checkout:

   ```sh
   npm install
   npm run build
   ```

5. Copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/chain-runner/`.
   In Obsidian, enable **Chain Runner** under **Settings → Community plugins**.

For repeat installs, put `VAULT_PATH=<absolute path to your vault>` in this checkout's `.env` and
run `npm run deploy`. This builds and copies the same three files; reload Obsidian after updating.

In **Settings → Chain Runner**, set **Engine URL** if the engine is elsewhere. The default is
`http://localhost:3000`. **Output folder** defaults to `chains/runs`. The status bar shows
**engine** when the URL responds and **offline** when it cannot be reached.

## First run: a note

1. Open a Markdown note with a rough idea, for example, “A library that lends out tools.” Select a
   passage to use only that passage, or leave nothing selected to use the note's body.
2. Open the command palette and choose **Chain Runner: Run chain on this note**.
3. Pick a chain. If it asks for a dropdown value, choose one. For a seeded chain, use the note as a
   rough hint or choose **Start with no hint**. An empty note starts without a hint.
4. If offered a run count, choose **1** for a first run. The right sidebar shows the run as its
   outputs arrive. The engine also keeps the run in its history.

A chain marked **reads its own files** ignores the note's text. An engine without the required
layout streaming capability refuses a note run and needs updating.

## Work on an Excalidraw drawing

1. Open a drawing as its own Excalidraw tab. Run **Chain Runner: Add chain node** from the command
   palette, then choose a chain and any requested dropdown value. The node lands at the cursor.
2. Connect a note or text block to the node with an arrow if the chain needs input from the drawing.
   A chain that reads its own files needs no bound input.
3. Double-click **▶ Run** on the node, or Ctrl/Cmd+click its link. A run frame and its output cards
   appear beside the node as the chain writes.
4. Click the chain name, dropdown, or run count on the node to change it. A grouped node may need a
   second click to reach an individual line. If a selected line does not respond, click away and back
   or Ctrl/Cmd+click it.

The Excalidraw **Tools Panel** also has **Add chain node** (the gem at the top right). That button
places an empty node; choose its chain on the node itself. A node run count greater than 1 needs an
engine that advertises grouped runs and creates a separate frame for each run.

To explore one existing block, select a single text block or note on the drawing and run
**Chain Runner: Expand this block with a chain**. Its output cards are proposals. Use **✓ Keep** or
**✕ Drop** with Ctrl/Cmd+click, or select a proposal and use the corresponding command palette action.

## Saved outputs

- In the sidebar, **Save as note** opens a finished, filled panel as a vault note. **Send to
  drawing** saves that panel and places it as an embeddable on a drawing you choose. These actions
  appear once there is output to keep.
- Drawing runs save output cards as notes automatically. By default, each lives at
  `chains/runs/<runId>/<output>.md`; changing **Output folder** changes the first part of the path.
- Each output note records its run, chain, output name, and a source link in frontmatter. The
  displayed **source run** link opens that run in maestro-playground. Saving the same panel again
  reuses identical content; a different note at the target path gets a numbered filename.
- **Keep lines** on a finished sidebar panel saves selected lines as a trimmed note, or runs another
  chain on them. A proposal you drop from a drawing is removed and its note goes to Obsidian's
  trash.

## Basic troubleshooting

- **Offline** or **The engine is offline**: start maestro-playground and check **Engine URL**. A
  responding engine can still have a broken workspace; check its own error if a run fails.
- **No chains in the workspace**: add a chain in maestro-playground, then retry. A chain that
  expects drawing input needs a readable block connected to its node.
- **No drawing or Excalidraw notice**: enable Excalidraw 2.0.0 or newer and open the drawing in
  Excalidraw view. The palette's **Add chain node** acts on a drawing tab, not a Markdown tab
  containing an embedded drawing.
- **A card looks blank**: open its linked output note and check whether the text was saved. If the
  note has the expected text, inspect the drawing card and its link; record the run id and drawing
  for investigation.
- **An old source run link says deleted**: the engine answered but no longer has that run. An
  unreachable engine leaves the link in place.

## For contributors

`npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` check the plugin.
`npm run smoke` checks a running engine; `npm run smoke -- --launch` starts a real model run.

Excalidraw API findings and vault-specific behavior live in
[docs/agents/excalidraw.md](docs/agents/excalidraw.md). Design decisions live in
[docs/adr/](docs/adr/), including panel projection, output files, source links, and node clicks.
