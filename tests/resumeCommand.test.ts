import { describe, it, expect, beforeEach } from 'vitest'
import { NOT_A_HOLD_NOTE, Resume } from '@/ui/resume'
import type { EngineClient } from '@/engine/client'
import type { RunEvent } from '@/engine/types'
import type { App, TFile } from 'obsidian'
import { TFile as StubFile, TFolder } from './obsidian'

/**
 * The order "Resume" happens in: what it refuses to run on, what it sends the
 * engine, and what it writes back to the vault. The pure pieces are
 * `holdNote.test.ts`, `canon.test.ts` and `resume.test.ts`; this is only the
 * orchestration between them.
 */

const HOLD_PATH = 'Maestro/holds/2026-09-15-Ab3dE1.md'

const holdNote = (direction = 'KEEP: fast combat\nCANON?\n- [x] halo = burden — character-director\n- [ ] permanent cost — gameplay-director\n') =>
  `# Hold: run 2026-09-15-Ab3dE1 · creative-director\n\n## Direction\n${direction}\n## Conversation\n`

let active: TFile | undefined
let notes: Record<string, string>
let folders: string[]
let notices: string[]
let runFrames: RunEvent[]
let online: boolean
let requests: unknown[]

function file(path: string): TFile {
  const stub = new StubFile()
  stub.path = path
  stub.name = path.slice(path.lastIndexOf('/') + 1)
  stub.extension = 'md'
  return stub as unknown as TFile
}

function makeResume(): Resume {
  const app = {
    workspace: {
      getActiveFile: () => active ?? null,
    },
    vault: {
      getAbstractFileByPath: (path: string) => {
        if (notes[path] !== undefined) return file(path)
        if (folders.includes(path)) {
          const folder = new TFolder()
          folder.path = path
          return folder
        }
        return null
      },
      cachedRead: (target: { path: string }) => Promise.resolve(notes[target.path] ?? ''),
      create: (path: string, content: string) => {
        notes[path] = content
        return Promise.resolve(file(path))
      },
      modify: (target: { path: string }, content: string) => {
        notes[target.path] = content
        return Promise.resolve()
      },
      createFolder: (path: string) => {
        folders.push(path)
        return Promise.resolve(undefined)
      },
    },
  } as unknown as App

  const engine = {
    launchRun: async function* (request: unknown) {
      requests.push(request)
      for (const event of runFrames) yield event
    },
  } as unknown as EngineClient

  return new Resume({
    app,
    engine,
    withEngine: async action => (online ? action() : undefined),
    notify: message => void notices.push(message),
    engineUrl: () => 'http://localhost:3000',
  })
}

beforeEach(() => {
  notes = { [HOLD_PATH]: holdNote() }
  active = file(HOLD_PATH)
  folders = []
  notices = []
  runFrames = [{ type: 'run_start', runId: '2026-09-20-Xy9zW2' }]
  online = true
  requests = []
})

describe('start', () => {
  it('says there is nothing to resume when no note is open', async () => {
    active = undefined
    await makeResume().start()
    expect(notices).toEqual([NOT_A_HOLD_NOTE])
  })

  it('says there is nothing to resume for a note with no Direction heading', async () => {
    notes[HOLD_PATH] = 'just some words'
    await makeResume().start()
    expect(notices).toEqual([NOT_A_HOLD_NOTE])
  })

  it('sends develop-direction the Direction block, verbatim, as its seed', async () => {
    await makeResume().start()
    expect(requests).toEqual([
      {
        chainName: 'develop-direction',
        seedPrompt: 'KEEP: fast combat\nCANON?\n- [x] halo = burden — character-director\n- [ ] permanent cost — gameplay-director',
      },
    ])
  })

  it('sends the canon file’s text as context, when one already exists', async () => {
    notes['context/canon-anime-game.md'] = '## LOCKED\n- old commitment\n\n## UNRESOLVED\n\n## REJECTED\n'
    await makeResume().start()
    expect(requests).toEqual([
      expect.objectContaining({
        context: { 'canon-anime-game': '## LOCKED\n- old commitment\n\n## UNRESOLVED\n\n## REJECTED\n' },
      }),
    ])
  })

  it('writes only the ticked CANON? line to canon, under LOCKED', async () => {
    await makeResume().start()
    const canon = notes['context/canon-anime-game.md']
    expect(canon).toContain('- halo = burden')
    expect(canon).not.toContain('permanent cost')
  })

  it('touches no canon file at all when nothing was ticked', async () => {
    notes[HOLD_PATH] = holdNote('KEEP: fast combat\n')
    await makeResume().start()
    expect(notes['context/canon-anime-game.md']).toBeUndefined()
  })

  it('links the resulting run at the bottom of the hold note', async () => {
    await makeResume().start()
    expect(notes[HOLD_PATH]).toContain('## Resumed')
    expect(notes[HOLD_PATH]).toContain('2026-09-20-Xy9zW2')
  })

  it('says the run it resumed as', async () => {
    await makeResume().start()
    expect(notices).toEqual(['Resumed as run 2026-09-20-Xy9zW2'])
  })

  it('writes nothing when the engine is offline', async () => {
    online = false
    await makeResume().start()
    expect(notes[HOLD_PATH]).toBe(holdNote())
    expect(notes['context/canon-anime-game.md']).toBeUndefined()
  })

  it('still links and ticks canon when the run itself failed partway through', async () => {
    runFrames = [{ type: 'run_start', runId: '2026-09-20-Xy9zW2' }, { type: 'error', error: 'the model refused' }]
    await makeResume().start()
    expect(notes[HOLD_PATH]).toContain('2026-09-20-Xy9zW2')
    expect(notes['context/canon-anime-game.md']).toContain('halo = burden')
    expect(notices).toEqual(['Resumed as run 2026-09-20-Xy9zW2, but it failed: the model refused'])
  })

  it('writes nothing and says so when the engine never named a run', async () => {
    runFrames = [{ type: 'error', error: 'no such chain' }]
    await makeResume().start()
    expect(notes[HOLD_PATH]).toBe(holdNote())
    expect(notes['context/canon-anime-game.md']).toBeUndefined()
    expect(notices).toEqual(['Resume failed: no such chain'])
  })

  it('adds new ticks to an existing canon file without disturbing what is already LOCKED', async () => {
    notes['context/canon-anime-game.md'] = '## LOCKED\n- old commitment\n\n## UNRESOLVED\n\n## REJECTED\n'
    await makeResume().start()
    const canon = notes['context/canon-anime-game.md']
    expect(canon).toContain('- old commitment')
    expect(canon).toContain('- halo = burden')
  })
})
