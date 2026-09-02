import { describe, it, expect, beforeEach, vi } from 'vitest'
import { QuickRunner } from '@/ui/quickRun'
import type { EngineClient } from '@/engine/client'
import type { RunResult } from '@/run/session'
import type { App } from 'obsidian'
// The stub `obsidian` resolves to at test time. Its helpers are imported by path
// rather than through the alias, so `tsc` still checks the plugin against the
// real module's types.
import { MarkdownView, lastModal, resetModals } from './obsidian'

/**
 * The seam between Obsidian and the run: which note the command reads, how much
 * of it, and what it asks before launching. The pieces below it are checked on
 * their own; this checks the wiring the ticket's acceptance criteria live in.
 */

const CHAINS = [
  { slug: 'relay', name: 'Telephone Relay' },
  { slug: 'lens', name: 'Through A Lens', parameter: { name: 'lens', options: ['sceptic', 'builder'] } },
]

interface Note {
  name: string
  path: string
  extension: string
}

const note = (name: string): Note => ({ name, path: name, extension: 'md' })

/** What the run was launched with, and every state the view was shown. */
let launched: { chainName: string; seedPrompt: string; paramValue?: string }[]
let shown: RunResult[]
let notices: string[]
let files: Record<string, string>
/** The note the editor pane holds, and what is selected in it. */
let editing: { file: Note | null; selection: string } | undefined
/** What `getActiveFile()` answers — the workspace's active leaf, which need not be the editor. */
let activeFile: Note | null

function makeRunner(): QuickRunner {
  const app = {
    workspace: {
      getActiveFile: () => activeFile,
      getActiveViewOfType: (kind: unknown) =>
        kind === MarkdownView && editing
          ? { file: editing.file, editor: { getSelection: () => editing?.selection ?? '' } }
          : null,
    },
    vault: { cachedRead: (file: Note) => Promise.resolve(files[file.path] ?? '') },
  } as unknown as App

  const engine = {
    loadWorkspace: () => Promise.resolve({ chains: CHAINS, capabilities: { runLayoutFrames: true } }),
    launchRun: async function* (request: { chainName: string; seedPrompt: string; paramValue?: string }) {
      launched.push(request)
    },
  } as unknown as EngineClient

  return new QuickRunner({
    app,
    engine,
    withEngine: action => action(),
    openResultView: () =>
      Promise.resolve({
        show: (result: RunResult) => shown.push(result),
      } as unknown as Awaited<ReturnType<() => Promise<never>>>),
    notify: message => notices.push(message),
    markOffline: () => {},
  })
}

/** Opens the picker, then answers each modal in turn the way a reader would. */
async function run(...picks: number[]): Promise<void> {
  const runner = makeRunner()
  await runner.start()
  for (const pick of picks) {
    const modal = lastModal()
    if (!modal) throw new Error('no modal open')
    modal.choose(pick)
    await Promise.resolve()
  }
  await vi.waitFor(() => expect(launched.length + notices.length).toBeGreaterThan(0))
}

beforeEach(() => {
  resetModals()
  launched = []
  shown = []
  notices = []
  files = { 'premise.md': '---\ntags: [x]\n---\nthe whole note' }
  editing = { file: note('premise.md'), selection: '' }
  activeFile = note('premise.md')
})

describe('what the run reads', () => {
  it('runs the whole note, minus its frontmatter, when nothing is selected', async () => {
    await run(0)
    expect(launched[0].seedPrompt).toBe('the whole note')
    expect(shown[0].seed).toEqual({ note: 'premise.md', from: 'note' })
  })

  it('runs the selection when there is one, and the header says the run covered less', async () => {
    editing = { file: note('premise.md'), selection: 'one paragraph' }
    await run(0)
    expect(launched[0].seedPrompt).toBe('one paragraph')
    expect(shown[0].seed).toEqual({ note: 'premise.md', from: 'selection' })
  })

  it('takes the note and the selection from one pane, so the header names what was run', async () => {
    // A selection left in the editor while another leaf holds the active file.
    files['aside.md'] = 'the other note'
    editing = { file: note('aside.md'), selection: 'a passage of the aside' }
    activeFile = note('premise.md')
    await run(0)
    expect(launched[0].seedPrompt).toBe('a passage of the aside')
    expect(shown[0].seed).toEqual({ note: 'aside.md', from: 'selection' })
  })

  it('falls back to the active file when no editor is open', async () => {
    editing = undefined
    await run(0)
    expect(launched[0].seedPrompt).toBe('the whole note')
  })

  it('says so and runs nothing when the note is empty', async () => {
    files['premise.md'] = '---\ntags: [x]\n---\n'
    await run()
    expect(notices).toEqual(['This note is empty'])
    expect(launched).toEqual([])
  })
})

describe('the dropdown a chain declares', () => {
  it('launches on the pick when the chain declares none', async () => {
    await run(0)
    expect(launched[0]).toMatchObject({ chainName: 'Telephone Relay' })
    expect(launched[0].paramValue).toBeUndefined()
  })

  it('asks once, in a second suggester, before the run starts', async () => {
    const runner = makeRunner()
    await runner.start()
    lastModal()?.choose(1)
    await Promise.resolve()
    expect(launched).toEqual([])
    expect(lastModal()?.placeholder).toBe('Choose lens')
  })

  it('sends the value with the run, so the chain reads the parameter it declared', async () => {
    await run(1, 0)
    expect(launched[0]).toMatchObject({ chainName: 'Through A Lens', paramValue: 'sceptic' })
  })

  it('shows the name and the value in the header', async () => {
    await run(1, 1)
    expect(shown[0].parameter).toEqual({ name: 'lens', value: 'builder' })
  })
})
