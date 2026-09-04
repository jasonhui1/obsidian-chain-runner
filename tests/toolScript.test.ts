import { describe, it, expect, beforeEach } from 'vitest'
import { SCRIPT_BODY, SCRIPT_ICON, SCRIPT_NAME, installScript, scriptFiles, type ScriptVault } from '@/ui/toolScript'

/**
 * The toolbar button, as a pair of files in the vault. What Excalidraw does with
 * them is `docs/agents/excalidraw.md`; this is only what gets written and when.
 */

let files: Map<string, string>
let writes: string[]

const vault = (): ScriptVault => ({
  read: path => Promise.resolve(files.get(path)),
  write: (path, content) => {
    writes.push(path)
    files.set(path, content)
    return Promise.resolve()
  },
})

beforeEach(() => {
  files = new Map()
  writes = []
})

describe('where the script goes', () => {
  it('names the script and its icon after the button, side by side', () => {
    expect(scriptFiles('Excalidraw/Scripts').map(file => file.path)).toEqual([
      `Excalidraw/Scripts/${SCRIPT_NAME}.md`,
      `Excalidraw/Scripts/${SCRIPT_NAME}.svg`,
    ])
  })

  it('follows the folder Excalidraw is set to, trailing slash or not', () => {
    expect(scriptFiles('Meta/Scripts/')[0]?.path).toBe(`Meta/Scripts/${SCRIPT_NAME}.md`)
  })

  it('carries an icon of its own, so the button is not a cog', () => {
    expect(scriptFiles('x')[1]?.content).toBe(SCRIPT_ICON)
    expect(SCRIPT_ICON).toContain('<svg')
  })
})

describe('what the script says', () => {
  it('reaches this plugin by its manifest id, not a window global', () => {
    expect(SCRIPT_BODY).toContain('ea.plugin.app.plugins.plugins["chain-runner"]')
  })

  it('places the node on the drawing the button was pressed on', () => {
    expect(SCRIPT_BODY).toContain('runner.addChainNode(ea.targetView)')
  })

  it('says so rather than failing silently when the plugin is off', () => {
    expect(SCRIPT_BODY).toContain('Chain Runner is not enabled in this vault.')
  })
})

describe('installing it', () => {
  it('writes both files into a vault that has neither', async () => {
    expect(await installScript(vault(), 'Excalidraw/Scripts')).toEqual([
      `Excalidraw/Scripts/${SCRIPT_NAME}.md`,
      `Excalidraw/Scripts/${SCRIPT_NAME}.svg`,
    ])
  })

  it('writes nothing the second time, so a reload is not a vault change', async () => {
    await installScript(vault(), 'Excalidraw/Scripts')
    writes = []
    expect(await installScript(vault(), 'Excalidraw/Scripts')).toEqual([])
    expect(writes).toEqual([])
  })

  it('puts back a script somebody edited, so the button keeps working', async () => {
    await installScript(vault(), 'Excalidraw/Scripts')
    files.set(`Excalidraw/Scripts/${SCRIPT_NAME}.md`, 'throw new Error("edited")')
    expect(await installScript(vault(), 'Excalidraw/Scripts')).toEqual([`Excalidraw/Scripts/${SCRIPT_NAME}.md`])
    expect(files.get(`Excalidraw/Scripts/${SCRIPT_NAME}.md`)).toBe(SCRIPT_BODY)
  })
})
