// Copies the built plugin into the vault named by VAULT_PATH in .env.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const vault = env.match(/^VAULT_PATH=(.*)$/m)?.[1].trim()
if (!vault) throw new Error('VAULT_PATH is not set in .env')

const dest = join(vault, '.obsidian', 'plugins', 'chain-runner')
mkdirSync(dest, { recursive: true })
for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  if (!existsSync(file)) throw new Error(`${file} is missing — run npm run build first`)
  copyFileSync(file, join(dest, file))
}
console.log(`installed into ${dest}`)
