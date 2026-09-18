import type { FrontNote, NoteStore } from '@/ui/noteStore'

/**
 * The reader's notes held in memory, shared by every test that touches the
 * vault. It refuses what the vault refuses — a note created twice, a change to
 * one that is not there — and tells listeners of a write before the write resolves.
 */
export class MemoryNoteStore implements NoteStore {
  /** Every note, by path: set one to seed it, read one to see what was written. */
  readonly notes: Record<string, string>
  /** Each folder made, in the order it was made. */
  readonly folders: string[] = []
  /** Each note opened in a tab, in order. */
  readonly opened: string[] = []
  /** Each note sent to the trash, in order. */
  readonly trashed: string[] = []
  /** The note in front of the reader. */
  inFront: FrontNote | undefined
  private readonly changed: Record<string, number> = {}
  private readonly refusals = new Map<string, string>()
  private readonly listeners = new Set<(path: string) => void>()
  private clock = 0

  constructor(notes: Record<string, string> = {}) {
    this.notes = { ...notes }
  }

  /** Every write to `path` from now on fails, saying `reason`. */
  refuse(path: string, reason = 'the file is read-only'): void {
    this.refusals.set(path, reason)
  }

  /** Marks the note as changed at `time`; a later time is newer. */
  touch(path: string, time: number): void {
    this.changed[path] = time
  }

  at(path: string): 'note' | 'folder' | undefined {
    if (this.notes[path] !== undefined) return 'note'
    const under = `${path}/`
    if (this.folders.includes(path) || Object.keys(this.notes).some(one => one.startsWith(under))) return 'folder'
    return undefined
  }

  read(path: string): Promise<string | undefined> {
    return Promise.resolve(this.notes[path])
  }

  notesIn(folder: string): string[] {
    return Object.keys(this.notes)
      .filter(path => path.startsWith(`${folder}/`))
      .sort((a, b) => (this.changed[b] ?? 0) - (this.changed[a] ?? 0))
  }

  async create(path: string, content: string): Promise<void> {
    this.writable(path)
    if (this.at(path)) throw new Error(`${path} already exists`)
    this.write(path, content)
  }

  async modify(path: string, content: string): Promise<void> {
    this.existing(path)
    this.write(path, content)
  }

  async process(path: string, edit: (content: string) => string): Promise<void> {
    this.write(path, edit(this.existing(path)))
  }

  async createFolder(path: string): Promise<void> {
    this.writable(path)
    if (this.at(path)) throw new Error(`${path} already exists`)
    this.folders.push(path)
  }

  async rename(from: string, to: string): Promise<void> {
    const content = this.existing(from)
    if (this.at(to)) throw new Error(`${to} already exists`)
    delete this.notes[from]
    this.notes[to] = content
    this.changed[to] = this.changed[from] ?? 0
  }

  async trash(path: string): Promise<void> {
    if (this.notes[path] === undefined) return
    this.writable(path)
    delete this.notes[path]
    this.trashed.push(path)
    this.tell(path)
  }

  onChange(listener: (path: string) => void): () => void {
    const own = (path: string): void => listener(path)
    this.listeners.add(own)
    return () => void this.listeners.delete(own)
  }

  front(): FrontNote | undefined {
    return this.inFront
  }

  async open(path: string): Promise<void> {
    if (this.notes[path] === undefined) throw new Error(`${path} is not a note`)
    this.opened.push(path)
  }

  /** A link names its note by path, with or without the extension. */
  resolveLink(linkpath: string): string | undefined {
    const path = linkpath.endsWith('.md') ? linkpath : `${linkpath}.md`
    return this.notes[path] === undefined ? undefined : path
  }

  private write(path: string, content: string): void {
    this.notes[path] = content
    this.changed[path] = ++this.clock
    this.tell(path)
  }

  private tell(path: string): void {
    for (const listener of [...this.listeners]) listener(path)
  }

  /** The note's text, for a change to it; the vault refuses a change to what is not there. */
  private existing(path: string): string {
    this.writable(path)
    const content = this.notes[path]
    if (content === undefined) throw new Error(`${path} is not a note`)
    return content
  }

  private writable(path: string): void {
    const refused = this.refusals.get(path)
    if (refused !== undefined) throw new Error(refused)
  }
}
