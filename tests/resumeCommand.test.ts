import { describe, it, expect, beforeEach } from 'vitest'
import { NOT_A_HOLD_NOTE, Resume } from '@/ui/resume'
import { UNSUPPORTED_RESUME } from '@/run/resume'
import type { EngineClient } from '@/engine/client'
import { EngineHttpError } from '@/engine/transport'
import type { Capabilities, RunEvent } from '@/engine/types'
import type { App, TFile } from 'obsidian'
import { TFile as StubFile, TFolder } from './obsidian'

/**
 * The order "Resume" happens in: what it refuses to run on, what it sends the
 * engine, and what it writes back to the vault. The pure pieces are
 * `holdNote.test.ts`, `canon.test.ts` and `resume.test.ts`; this is only the
 * orchestration between them.
 */

const HOLD_PATH = 'Maestro/holds/2026-09-15-Ab3dE1.md'

const WAITING = [
  '## Waiting at decider',
  '',
  'Reached 2026-09-15T10:00:00Z',
  '',
  '- [ ] Candidate 1',
  '  a trial in a void',
  '- [ ] Candidate 2',
  '  a trial in a city',
  '',
].join('\n')

const holdNote = (
  direction = 'KEEP: fast combat\nCANON?\n- [x] halo = burden — character-director\n- [ ] permanent cost — gameplay-director\n',
  waiting = WAITING,
) => `# Hold: run 2026-09-15-Ab3dE1 · creative-director\n\n${waiting}\n## Direction\n${direction}\n## Conversation\n`

let active: TFile | undefined
let notes: Record<string, string>
let folders: string[]
let notices: string[]
let runFrames: RunEvent[]
let online: boolean
let requests: unknown[]
let refusal: unknown
let refreshed: string[]
let openedForks: string[]
let refuseWrites: boolean
let capabilities: Capabilities

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
        if (refuseWrites) return Promise.reject(new Error('the file is read-only'))
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
    loadWorkspace: () => Promise.resolve({ chains: [], capabilities }),
    resumeRun: function* (runId: string, request: unknown) {
      requests.push({ runId, request })
      if (refusal) throw refusal
      return yield* runFrames
    },
  } as unknown as EngineClient

  return new Resume({
    app,
    engine,
    withEngine: async action => (online ? action() : undefined),
    notify: message => void notices.push(message),
    engineUrl: () => 'http://localhost:3000',
    refresh: runId => Promise.resolve(refreshed.push(runId)),
    openFork: runId => Promise.resolve(openedForks.push(runId)),
  })
}

beforeEach(() => {
  notes = { [HOLD_PATH]: holdNote() }
  active = file(HOLD_PATH)
  folders = []
  notices = []
  runFrames = [{ type: 'run_start', runId: '2026-09-15-Ab3dE1' }]
  online = true
  requests = []
  refusal = undefined
  refreshed = []
  openedForks = []
  refuseWrites = false
  capabilities = { runResume: true }
})

describe('start', () => {
  it('asks nothing of an engine that says it cannot resume, leaves the note, and says so', async () => {
    capabilities = { runResume: false }
    const before = notes[HOLD_PATH]
    await makeResume().start()
    expect(requests).toEqual([])
    expect(notes[HOLD_PATH]).toBe(before)
    expect(notices).toEqual([UNSUPPORTED_RESUME])
  })

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

  it('posts the Direction block, verbatim, to the run the note names', async () => {
    await makeResume().start()
    expect(requests).toEqual([
      {
        runId: '2026-09-15-Ab3dE1',
        request: {
          direction: 'KEEP: fast combat\nCANON?\n- [x] halo = burden — character-director\n- [ ] permanent cost — gameplay-director',
          custom: 'KEEP: fast combat',
        },
      },
    ])
  })

  it('sends the ticked candidate as chosen, and no custom alongside it', async () => {
    notes[HOLD_PATH] = holdNote(undefined, WAITING.replace('- [ ] Candidate 2', '- [x] Candidate 2'))
    await makeResume().start()
    expect(requests).toEqual([expect.objectContaining({ request: expect.objectContaining({ chosen: 'Candidate 2' }) })])
    expect((requests[0] as { request: { custom?: string } }).request.custom).toBeUndefined()
  })

  it('names the hold by its node id when the note shows the run waiting at more than one', async () => {
    const second = '## Waiting at greenlighter\n\nReached 2026-09-15T10:01:00Z\n\n- [x] Candidate 1\n  ship it\n'
    notes[HOLD_PATH] = holdNote(undefined, `${WAITING}\n${second}`)
    await makeResume().start()
    expect(requests).toEqual([expect.objectContaining({ request: expect.objectContaining({ holdId: 'greenlighter', chosen: 'Candidate 1' }) })])
  })

  it('names no hold when the note shows only one open', async () => {
    await makeResume().start()
    expect((requests[0] as { request: { holdId?: string } }).request.holdId).toBeUndefined()
  })

  it('sends the canon file’s text as context, when one already exists', async () => {
    notes['context/canon-anime-game.md'] = '## LOCKED\n- old commitment\n\n## UNRESOLVED\n\n## REJECTED\n'
    await makeResume().start()
    expect(requests).toEqual([
      expect.objectContaining({
        request: expect.objectContaining({ context: { 'canon-anime-game': '## LOCKED\n- old commitment\n\n## UNRESOLVED\n\n## REJECTED\n' } }),
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
    expect(notes[HOLD_PATH]).toContain('2026-09-15-Ab3dE1')
  })

  it('says the run it resumed as', async () => {
    await makeResume().start()
    expect(notices).toEqual(['Resumed as run 2026-09-15-Ab3dE1'])
  })

  it('writes nothing when the engine is offline', async () => {
    online = false
    await makeResume().start()
    expect(notes[HOLD_PATH]).toBe(holdNote())
    expect(notes['context/canon-anime-game.md']).toBeUndefined()
  })

  it('still links the run but skips canon when it failed partway through', async () => {
    runFrames = [{ type: 'run_start', runId: '2026-09-15-Ab3dE1' }, { type: 'error', error: 'the model refused' }]
    await makeResume().start()
    expect(notes[HOLD_PATH]).toContain('2026-09-15-Ab3dE1')
    expect(notes['context/canon-anime-game.md']).toBeUndefined()
    expect(notices).toEqual(['Resumed as run 2026-09-15-Ab3dE1, but it failed: the model refused (canon not written)'])
  })

  it('says nothing extra about canon on failure when nothing was ticked', async () => {
    notes[HOLD_PATH] = holdNote('KEEP: fast combat\n')
    runFrames = [{ type: 'run_start', runId: '2026-09-15-Ab3dE1' }, { type: 'error', error: 'the model refused' }]
    await makeResume().start()
    expect(notices).toEqual(['Resumed as run 2026-09-15-Ab3dE1, but it failed: the model refused'])
  })

  it('writes nothing and says so when the stream never named a run', async () => {
    runFrames = [{ type: 'error', error: 'nothing to resume' }]
    await makeResume().start()
    expect(notes[HOLD_PATH]).toBe(holdNote())
    expect(notes['context/canon-anime-game.md']).toBeUndefined()
    expect(notices).toEqual(['Resume failed: nothing to resume'])
  })

  it('says why a still-running run was refused, and writes nothing', async () => {
    refusal = new EngineHttpError(409, '/resume', '{"error":"run is running"}')
    await makeResume().start()
    expect(notes[HOLD_PATH]).toBe(holdNote())
    expect(notes['context/canon-anime-game.md']).toBeUndefined()
    expect(notices).toEqual(['Run 2026-09-15-Ab3dE1 cannot be resumed yet: run is running'])
  })

  it('brings the hold note up to date with the run it carried on as', async () => {
    await makeResume().start()
    expect(refreshed).toEqual(['2026-09-15-Ab3dE1'])
    expect(openedForks).toEqual([])
  })

  it('leaves the note as it stands when the continued run failed', async () => {
    runFrames = [{ type: 'run_start', runId: '2026-09-15-Ab3dE1' }, { type: 'error', error: 'the model refused' }]
    await makeResume().start()
    expect(refreshed).toEqual([])
  })

  it('adds new ticks to an existing canon file without disturbing what is already LOCKED', async () => {
    notes['context/canon-anime-game.md'] = '## LOCKED\n- old commitment\n\n## UNRESOLVED\n\n## REJECTED\n'
    await makeResume().start()
    const canon = notes['context/canon-anime-game.md']
    expect(canon).toContain('- old commitment')
    expect(canon).toContain('- halo = burden')
  })
})

/** A hold already answered is not carried on: the engine starts a new run and names it up front (#53). */
describe('a resume the engine forked', () => {
  beforeEach(() => {
    runFrames = [{ type: 'run_start', runId: '2026-09-21-Forked' }]
  })

  it('opens the fork own hold note, not the run the resume was posted to', async () => {
    await makeResume().start()
    expect(openedForks).toEqual(['2026-09-21-Forked'])
  })

  it('brings the note it forked from up to date, so it stops offering a hold the engine has answered', async () => {
    await makeResume().start()
    expect(refreshed).toEqual(['2026-09-15-Ab3dE1'])
  })

  it('says in the note it forked from that the live run is elsewhere', async () => {
    await makeResume().start()
    expect(notes[HOLD_PATH]).toContain('forked as [run 2026-09-21-Forked]')
    expect(notes[HOLD_PATH]).toContain('the live run is there now')
  })

  it('says it forked rather than carried on', async () => {
    await makeResume().start()
    expect(notices).toEqual(['Resumed — forked as run 2026-09-21-Forked'])
  })

  it('still shows the fork, and still answers the old hold, when the forked run failed', async () => {
    runFrames = [{ type: 'run_start', runId: '2026-09-21-Forked' }, { type: 'error', error: 'the model refused' }]
    await makeResume().start()
    expect(openedForks).toEqual(['2026-09-21-Forked'])
    expect(refreshed).toEqual(['2026-09-15-Ab3dE1'])
  })
})

describe('resumeNote', () => {
  it('reports the run the resume carried on as', async () => {
    expect(await makeResume().resumeNote(file(HOLD_PATH))).toEqual({ runId: '2026-09-15-Ab3dE1', forked: false, canon: 'written' })
  })

  it('reports a forked run under the id the stream named, not the one it posted to', async () => {
    runFrames = [{ type: 'run_start', runId: '2026-09-21-Forked' }]
    expect(await makeResume().resumeNote(file(HOLD_PATH))).toMatchObject({ runId: '2026-09-21-Forked', forked: true })
  })

  it('says the ticks were held back when the run failed', async () => {
    runFrames = [{ type: 'run_start', runId: '2026-09-15-Ab3dE1' }, { type: 'error', error: 'the model refused' }]
    const result = await makeResume().resumeNote(file(HOLD_PATH))
    expect(result).toEqual({ runId: '2026-09-15-Ab3dE1', forked: false, error: 'the model refused', canon: 'held-back' })
  })

  it('carries the failure with no run when the stream never named one', async () => {
    runFrames = [{ type: 'error', error: 'nothing to resume' }]
    expect(await makeResume().resumeNote(file(HOLD_PATH))).toEqual({ error: 'nothing to resume', forked: false, canon: 'held-back' })
  })

  it('has nothing to report when the engine is offline', async () => {
    online = false
    expect(await makeResume().resumeNote(file(HOLD_PATH))).toBeUndefined()
  })

  it('has nothing to report when the engine refused, which says why on its own', async () => {
    refusal = new EngineHttpError(404, '/resume', 'no such hold')
    expect(await makeResume().resumeNote(file(HOLD_PATH))).toBeUndefined()
    expect(notices).toEqual(['Run 2026-09-15-Ab3dE1 no longer has the hold this note answers'])
  })

  it('says there is nothing to resume for a note that is not a hold', async () => {
    notes[HOLD_PATH] = 'just some words'
    expect(await makeResume().resumeNote(file(HOLD_PATH))).toBeUndefined()
    expect(notices).toEqual([NOT_A_HOLD_NOTE])
  })

  it('still reports the run when the hold note refuses the link', async () => {
    refuseWrites = true
    const result = await makeResume().resumeNote(file(HOLD_PATH))
    expect(result).toMatchObject({ runId: '2026-09-15-Ab3dE1' })
    expect(notices).toContain('Could not write the hold note: the file is read-only')
  })
})
