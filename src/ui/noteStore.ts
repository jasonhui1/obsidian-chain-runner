import { MarkdownView, TFile, TFolder, type App, type TAbstractFile } from 'obsidian'

/**
 * The reader's notes as the plugin uses them: read and written by path, and the
 * one in front of the reader. `createNoteStore` is the vault behind it;
 * `tests/memoryNoteStore.ts` is the one every test shares.
 */
export interface NoteStore {
  /** What is at `path`: a note, a folder, or nothing. */
  at(path: string): 'note' | 'folder' | undefined
  /** A note's text, or `undefined` when there is no note there. */
  read(path: string): Promise<string | undefined>
  /** Every note under `folder`, most recently changed first. */
  notesIn(folder: string): string[]
  /** A new note; refused when one is already there. */
  create(path: string, content: string): Promise<void>
  modify(path: string, content: string): Promise<void>
  /** Rewrites a note in one step, so nothing written between the read and the write is lost. */
  process(path: string, edit: (content: string) => string): Promise<void>
  createFolder(path: string): Promise<void>
  /** Moves a note, the links to it following. */
  rename(from: string, to: string): Promise<void>
  /** To the trash, so the reader's own deletion setting decides how final it is. */
  trash(path: string): Promise<void>
  /** Hears the path of every note created, changed or deleted, by any hand; returns what stops it. */
  onChange(listener: (path: string) => void): () => void
  /** The markdown note in front of the reader, and what is selected in it. */
  front(): FrontNote | undefined
  /** Opens a note in a tab of its own. */
  open(path: string): Promise<void>
  /** The note a wiki link on the note at `from` points at. */
  resolveLink(linkpath: string, from: string): string | undefined
}

export interface FrontNote {
  path: string
  /** The editor's selection, when the note is open in one. */
  selection?: string
}

/** The note in front of the reader and what it says; `undefined` when there is none. */
export async function readFront(store: NoteStore): Promise<{ path: string; content: string } | undefined> {
  const path = store.front()?.path
  const content = path === undefined ? undefined : await store.read(path)
  return path === undefined || content === undefined ? undefined : { path, content }
}

/** The folder a note is in; `''` at the vault root. */
export function folderOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf('/'), 0))
}

/** A note's file name, extension and all. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** A note's name as the vault shows it, without its extension. */
export function baseName(path: string): string {
  const name = fileName(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** A file as the workspace hands it over; only a markdown one is a note. */
interface OpenFile {
  path: string
  extension: string
}

/**
 * The note in front of the reader: the editor's, with its selection, or the
 * active file's when no editor is open. The note and the selection come from one view, never two.
 */
export function frontOf(editing: { file: OpenFile | null; selection: string } | undefined, active: OpenFile | null): FrontNote | undefined {
  const file = editing?.file ?? active
  if (!file || file.extension !== 'md') return undefined
  return { path: file.path, ...(editing ? { selection: editing.selection } : {}) }
}

export function createNoteStore(app: App): NoteStore {
  const { vault, workspace, fileManager, metadataCache } = app
  const note = (path: string): TFile => {
    const found = vault.getAbstractFileByPath(path)
    if (found instanceof TFile) return found
    throw new Error(`${path} is not a note`)
  }
  return {
    at: path => {
      const found = vault.getAbstractFileByPath(path)
      if (found instanceof TFile) return 'note'
      return found instanceof TFolder ? 'folder' : undefined
    },
    read: async path => {
      const found = vault.getAbstractFileByPath(path)
      return found instanceof TFile ? vault.cachedRead(found) : undefined
    },
    notesIn: folder =>
      vault
        .getMarkdownFiles()
        .filter(file => file.path.startsWith(`${folder}/`))
        .sort((a, b) => b.stat.mtime - a.stat.mtime)
        .map(file => file.path),
    create: async (path, content) => void (await vault.create(path, content)),
    modify: async (path, content) => vault.modify(note(path), content),
    process: async (path, edit) => void (await vault.process(note(path), edit)),
    createFolder: async path => void (await vault.createFolder(path)),
    rename: async (from, to) => fileManager.renameFile(note(from), to),
    trash: async path => {
      const found = vault.getAbstractFileByPath(path)
      if (found instanceof TFile) await fileManager.trashFile(found)
    },
    onChange: listener => {
      const heard = (file: TAbstractFile): void => listener(file.path)
      const refs = [vault.on('modify', heard), vault.on('create', heard), vault.on('delete', heard)]
      return () => refs.forEach(ref => vault.offref(ref))
    },
    front: () => {
      const editing = workspace.getActiveViewOfType(MarkdownView)
      return frontOf(editing ? { file: editing.file, selection: editing.editor.getSelection() } : undefined, workspace.getActiveFile())
    },
    open: async path => workspace.getLeaf('tab').openFile(note(path)),
    resolveLink: (linkpath, from) => metadataCache.getFirstLinkpathDest(linkpath, from)?.path,
  }
}
