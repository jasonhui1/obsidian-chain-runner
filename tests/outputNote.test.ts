import { describe, it, expect } from 'vitest'
import { outputNoteContent, outputNotePath, resolveOutputPath } from '@/run/outputNote'
import type { RunPanel } from '@/run/panels'

/**
 * The output-note convention, checked the way every later ticket will use it:
 * a panel and a run's meta in, a file path and a file's content out. Nothing
 * here touches a vault, so the convention is pinned without one.
 */

const panel = (over: Partial<RunPanel> = {}): RunPanel => ({
  name: 'Optimist',
  node: 'n1',
  text: 'It could work.',
  lines: 1,
  state: 'filled',
  ...over,
})

const meta = { runId: '2026-09-02-ab12c', chainName: 'Five Personas', folder: 'chains/runs' }

describe('outputNotePath', () => {
  it('files the note under the run it came from', () => {
    expect(outputNotePath(panel(), meta)).toBe('chains/runs/2026-09-02-ab12c/Optimist.md')
  })

  it('follows the folder the reader set', () => {
    expect(outputNotePath(panel(), { ...meta, folder: 'notes/chain output/' })).toBe(
      'notes/chain output/2026-09-02-ab12c/Optimist.md',
    )
  })

  it('keeps the output name readable, minus what a filename cannot hold', () => {
    expect(outputNotePath(panel({ name: 'What/who? "the join"' }), meta)).toBe(
      'chains/runs/2026-09-02-ab12c/What-who- -the join-.md',
    )
  })

  it('falls back to a name rather than writing a nameless file', () => {
    expect(outputNotePath(panel({ name: '///' }), meta)).toBe('chains/runs/2026-09-02-ab12c/output.md')
  })
})

describe('outputNoteContent', () => {
  it('stamps the run, the chain and the output above the hop’s own text', () => {
    expect(outputNoteContent(panel(), meta)).toBe(
      ['---', 'run: "2026-09-02-ab12c"', 'chain: "Five Personas"', 'output: "Optimist"', '---', '', 'It could work.', ''].join(
        '\n',
      ),
    )
  })

  it('quotes a name that would otherwise break the frontmatter', () => {
    const content = outputNoteContent(panel({ name: 'the "join"' }), { ...meta, chainName: 'a: chain' })
    expect(content).toContain('chain: "a: chain"')
    expect(content).toContain('output: "the \\"join\\""')
  })

  it('writes the hop’s text as it stands, frontmatter of its own included', () => {
    const content = outputNoteContent(panel({ text: '---\ntitle: inner\n---\n\nbody' }), meta)
    expect(content.endsWith('---\ntitle: inner\n---\n\nbody\n')).toBe(true)
  })
})

describe('resolveOutputPath', () => {
  const reader =
    (held: Record<string, string>) =>
    (path: string): Promise<string | undefined> =>
      Promise.resolve(held[path])

  it('takes the plain path when nothing holds it', async () => {
    expect(await resolveOutputPath('runs/Optimist.md', 'text', reader({}))).toBe('runs/Optimist.md')
  })

  it('suffixes past a note that holds something else', async () => {
    expect(await resolveOutputPath('runs/Optimist.md', 'text', reader({ 'runs/Optimist.md': 'older text' }))).toBe(
      'runs/Optimist 2.md',
    )
  })

  it('keeps suffixing while the suffixed names are taken too', async () => {
    const held = { 'runs/Optimist.md': 'a', 'runs/Optimist 2.md': 'b', 'runs/Optimist 3.md': 'c' }
    expect(await resolveOutputPath('runs/Optimist.md', 'text', reader(held))).toBe('runs/Optimist 4.md')
  })

  it('reuses a note that already says exactly this, rather than writing it twice', async () => {
    const held = { 'runs/Optimist.md': 'a', 'runs/Optimist 2.md': 'text' }
    expect(await resolveOutputPath('runs/Optimist.md', 'text', reader(held))).toBe('runs/Optimist 2.md')
  })
})
