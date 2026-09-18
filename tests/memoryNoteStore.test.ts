import { describe, it, expect } from 'vitest'
import { MemoryNoteStore } from './memoryNoteStore'

/**
 * The in-memory notes every vault test shares: the ordering the modules rely
 * on, held to the vault's.
 */

describe('MemoryNoteStore', () => {
  it('reads a note created, then modified', async () => {
    const store = new MemoryNoteStore()
    await store.create('a.md', 'one')
    await store.modify('a.md', 'two')
    expect(await store.read('a.md')).toBe('two')
  })

  it('refuses a note created twice, and a change to one that is not there', async () => {
    const store = new MemoryNoteStore({ 'a.md': 'one' })
    await expect(store.create('a.md', 'again')).rejects.toThrow('a.md already exists')
    await expect(store.modify('b.md', 'two')).rejects.toThrow('b.md is not a note')
    await expect(store.process('b.md', text => text)).rejects.toThrow('b.md is not a note')
  })

  it('tells a listener of a modify before the modify resolves', async () => {
    const store = new MemoryNoteStore({ 'a.md': 'one' })
    const heard: string[] = []
    store.onChange(path => heard.push(`${path}: ${store.notes[path]}`))
    const modified = store.modify('a.md', 'two')
    expect(heard).toEqual(['a.md: two'])
    await modified
  })

  it('tells a listener of a create, a process and a trash, and nothing once stopped', async () => {
    const store = new MemoryNoteStore()
    const heard: string[] = []
    const stop = store.onChange(path => heard.push(path))
    await store.create('a.md', 'one')
    await store.process('a.md', text => `${text}!`)
    await store.trash('a.md')
    stop()
    await store.create('b.md', 'two')
    expect(heard).toEqual(['a.md', 'a.md', 'a.md'])
    expect(store.trashed).toEqual(['a.md'])
  })

  it('moves a note on rename, and refuses to rename over one', async () => {
    const store = new MemoryNoteStore({ 'a.md': 'one', 'c.md': 'three' })
    await store.rename('a.md', 'b.md')
    expect(store.notes).toEqual({ 'b.md': 'one', 'c.md': 'three' })
    await expect(store.rename('b.md', 'c.md')).rejects.toThrow('c.md already exists')
  })

  it('lists a folder most recently changed first, a rename keeping its time', async () => {
    const store = new MemoryNoteStore()
    await store.create('holds/a.md', 'one')
    await store.create('holds/b.md', 'two')
    await store.modify('holds/a.md', 'one again')
    await store.rename('holds/b.md', 'holds/c.md')
    await store.create('elsewhere.md', 'three')
    expect(store.notesIn('holds')).toEqual(['holds/a.md', 'holds/c.md'])
  })

  it('sees a folder that holds a note, and one made empty', async () => {
    const store = new MemoryNoteStore({ 'holds/a.md': 'one' })
    await store.createFolder('empty')
    expect([store.at('holds'), store.at('empty'), store.at('holds/a.md'), store.at('nothing')]).toEqual(['folder', 'folder', 'note', undefined])
  })

  it('fails every write to a refused path, saying why', async () => {
    const store = new MemoryNoteStore({ 'a.md': 'one' })
    store.refuse('a.md')
    await expect(store.process('a.md', text => text)).rejects.toThrow('the file is read-only')
    expect(await store.read('a.md')).toBe('one')
  })
})
