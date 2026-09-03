import { describe, it, expect } from 'vitest'
import { freeOutputPath, outputNoteContent, outputNotePath, resolveOutputPath } from '@/run/outputNote'
import type { RunPanel } from '@/run/panels'

/**
 * The output-note convention: a panel and a run's meta in, a path and a file's
 * content out. Nothing here touches a vault.
 */

const panel = (over: Partial<RunPanel> = {}): RunPanel => ({
  name: 'Optimist',
  node: 'n1',
  text: 'It could work.',
  lines: 1,
  state: 'filled',
  ...over,
})

const meta = {
  runId: '2026-09-02-ab12c',
  chainName: 'Five Personas',
  folder: 'chains/runs',
  engineUrl: 'http://localhost:3000',
}

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
    // Nothing survives the trim, and a note called `.md` would be hidden.
    expect(outputNotePath(panel({ name: '...' }), meta)).toBe('chains/runs/2026-09-02-ab12c/output.md')
    expect(outputNotePath(panel({ name: '   ' }), meta)).toBe('chains/runs/2026-09-02-ab12c/output.md')
  })
})

describe('outputNoteContent', () => {
  it('stamps the run, the chain, the output and the run’s link above the hop’s own text', () => {
    expect(outputNoteContent(panel(), meta)).toBe(
      [
        '---',
        'run: "2026-09-02-ab12c"',
        'chain: "Five Personas"',
        'output: "Optimist"',
        'source: "http://localhost:3000/history/2026-09-02-ab12c"',
        '---',
        '',
        'It could work.',
        '',
      ].join('\n'),
    )
  })

  it('leaves the link out rather than writing a broken one', () => {
    expect(outputNoteContent(panel(), { ...meta, engineUrl: 'not a url' })).not.toContain('source:')
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

  it('gives up rather than spinning, when every name it tries comes back taken', async () => {
    await expect(resolveOutputPath('runs/Optimist.md', 'text', () => Promise.resolve('taken'))).rejects.toThrow(
      /are all taken/,
    )
  })
})

describe('a note opened before it has content', () => {
  /** The vault as the walk sees it: a path holds a note, or it does not. */
  const held = (paths: string[]) => (path: string) => Promise.resolve(paths.includes(path) ? '' : undefined)

  it('takes the name when nothing holds it', async () => {
    expect(await freeOutputPath('chains/runs/r1/Optimist.md', held([]))).toBe('chains/runs/r1/Optimist.md')
  })

  it('never reuses a note that happens to say the same nothing', async () => {
    // Both are empty when opened, so the reuse rule would collapse them (ADR-0003).
    expect(await freeOutputPath('chains/runs/r1/Same.md', held(['chains/runs/r1/Same.md']))).toBe(
      'chains/runs/r1/Same 2.md',
    )
  })

  it('walks past every name that is taken', async () => {
    const taken = ['chains/runs/r1/Same.md', 'chains/runs/r1/Same 2.md', 'chains/runs/r1/Same 3.md']
    expect(await freeOutputPath('chains/runs/r1/Same.md', held(taken))).toBe('chains/runs/r1/Same 4.md')
  })
})

describe('a note for an output that never happened', () => {
  it('says why, quoted, rather than holding nothing but frontmatter', () => {
    const content = outputNoteContent(panel({ text: '', state: 'errored', error: 'no API key' }), meta)
    expect(content).toContain('> no API key')
  })

  it('quotes every line of a message that has several', () => {
    const content = outputNoteContent(panel({ text: '', state: 'errored', error: 'refused:\nno key' }), meta)
    expect(content).toContain('> refused:\n> no key')
  })

  it('leaves a hop that genuinely said nothing empty', () => {
    // `empty` is an answer; only a hop that never ran explains itself.
    expect(outputNoteContent(panel({ text: '', state: 'empty' }), meta)).toBe(
      '---\nrun: "2026-09-02-ab12c"\nchain: "Five Personas"\noutput: "Optimist"\n' +
        'source: "http://localhost:3000/history/2026-09-02-ab12c"\n---\n\n\n',
    )
  })

  it('keeps the hop’s own words when it produced some as well as an error', () => {
    const content = outputNoteContent(panel({ text: 'half an answer', state: 'errored', error: 'cut off' }), meta)
    expect(content).toContain('half an answer')
    expect(content).not.toContain('> cut off')
  })
})
