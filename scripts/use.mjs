// Swaps the vault's installed plugin between .builds/before and .builds/after.
import { copyFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const which = process.argv[2]
if (which !== 'before' && which !== 'after') throw new Error('usage: node scripts/use.mjs before|after')

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const vault = env.match(/^VAULT_PATH=(.*)$/m)?.[1].trim()
const dest = join(vault, '.obsidian', 'plugins', 'chain-runner')
for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  copyFileSync(join('.builds', which, file), join(dest, file))
}
console.log(`vault now runs the ${which} build — reload Obsidian (Ctrl+P, "Reload app without saving")`)
