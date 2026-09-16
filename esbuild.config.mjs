import esbuild from 'esbuild'
import process from 'node:process'
import builtins from 'builtin-modules'

const production = process.argv[2] === 'production'

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  // Everything Obsidian already loads stays external; `builtins` covers the Node
  // core modules the transport reaches for on desktop. Obsidian hands plugins
  // its own CodeMirror, and a second copy of it stops the proposal editor
  // starting (#43); only the Markdown language is ours to bundle.
  external: [
    'obsidian',
    'electron',
    '@codemirror/state',
    '@codemirror/view',
    '@codemirror/language',
    '@codemirror/commands',
    '@codemirror/autocomplete',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    ...builtins,
    ...builtins.map(m => `node:${m}`),
  ],
  format: 'cjs',
  target: 'es2022',
  logLevel: 'info',
  sourcemap: production ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
  minify: production,
})

if (production) {
  await context.rebuild()
  process.exit(0)
} else {
  await context.watch()
}
