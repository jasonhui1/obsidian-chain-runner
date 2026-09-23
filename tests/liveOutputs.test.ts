import { describe, expect, it } from 'vitest'
import { fillLiveOutputs, type LiveOutput } from '@/ui/liveOutputs'
import { OutputNotes } from '@/ui/outputNotes'
import type { FramedPanel } from '@/run/runFrame'
import type { RunPanel } from '@/run/panels'
import { MemoryNoteStore } from './memoryNoteStore'

const panel = (text: string, state: RunPanel['state']): RunPanel => ({
  name: 'First',
  node: 'first',
  text,
  lines: text.trim() === '' ? 0 : text.split('\n').length,
  state,
})

describe('settled output note refresh', () => {
  it('rewrites unchanged note content after the final frame', async () => {
    const store = new MemoryNoteStore()
    const writes: string[] = []
    store.onChange(path => writes.push(path))
    const notes = new OutputNotes({
      store,
      notify: () => undefined,
      folder: () => 'chains/runs',
      engineUrl: () => 'http://localhost:3000',
    })
    const opened = await notes.open(panel('', 'pending'), {
      runId: 'run-1',
      chainName: 'Relay',
    })
    expect(opened).toBeDefined()
    if (!opened) throw new Error('The output note should be available.')

    const settled = panel('The answer.', 'filled')
    await opened.write(settled)
    await opened.write(settled)
    expect(writes).toEqual([opened.path, opened.path])
    const output: LiveOutput<FramedPanel> = {
      index: 0,
      place: {
        panel: settled,
        index: 0,
        box: { x: 0, y: 0, width: 320, height: 240 },
        emphasis: false,
      },
      note: opened,
      written: { text: settled.text, state: settled.state },
    }

    await fillLiveOutputs([output], { kind: 'timeline', panels: [settled] }, true)

    expect(writes).toEqual([opened.path, opened.path, opened.path])
  })
})
