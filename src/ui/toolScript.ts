/**
 * The "Add chain node" button on the drawing. Excalidraw's own script engine is
 * the only way onto its canvas toolbar, and a script is a file in the vault, so
 * installing Chain Runner means writing that file. What the vault side of it
 * looks like is `docs/agents/excalidraw.md`.
 */

/** The script's name, which is the button's tooltip and the icon file's basename. */
export const SCRIPT_NAME = 'Add chain node'

/** Excalidraw's own default, used when its setting cannot be read. */
export const DEFAULT_SCRIPT_FOLDER = 'Excalidraw/Scripts'

/** The plugin id the script reaches this plugin by; `manifest.json`. */
const PLUGIN_ID = 'chain-runner'

/**
 * The script's body. Excalidraw strips the frontmatter and runs the rest as an
 * async function body with `ea` in scope, so this file is JavaScript despite the
 * `.md` — and `throw` is the only way it has to say something went wrong.
 */
export const SCRIPT_BODY = `/*
Drops a Chain Runner node at the cursor. Pick its chain on the node itself.
Written by the Chain Runner plugin; edits are overwritten when it loads.
*/
const runner = ea.plugin.app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
if (!runner || typeof runner.addChainNode !== "function") {
  throw new Error("Chain Runner is not enabled in this vault.");
}
await runner.addChainNode(ea.targetView);
`

/**
 * The button's icon: an SVG beside the script, which Excalidraw reads by name.
 * Two links of a chain, drawn in `currentColor` so it follows the theme.
 */
export const SCRIPT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
</svg>
`

/** One file the script needs in the vault. */
export interface ScriptFile {
  path: string
  content: string
}

/** The two files, under whichever folder Excalidraw is looking in. */
export function scriptFiles(folder: string): ScriptFile[] {
  const base = `${folder.replace(/\/+$/, '')}/${SCRIPT_NAME}`
  return [
    { path: `${base}.md`, content: SCRIPT_BODY },
    { path: `${base}.svg`, content: SCRIPT_ICON },
  ]
}

/** The vault, narrowed to what installing the script needs of it. */
export interface ScriptVault {
  /** The file's contents, or `undefined` when it is not there. */
  read(path: string): Promise<string | undefined>
  write(path: string, content: string): Promise<void>
}

/**
 * Writes the script and its icon, and answers which files it wrote. Only what
 * differs is written: Excalidraw reloads a script on every change, so a rewrite
 * of the same words would churn the toolbar on every load.
 */
export async function installScript(vault: ScriptVault, folder: string): Promise<string[]> {
  const written: string[] = []
  for (const file of scriptFiles(folder)) {
    if ((await vault.read(file.path)) === file.content) continue
    await vault.write(file.path, file.content)
    written.push(file.path)
  }
  return written
}
