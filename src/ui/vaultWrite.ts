import { TFolder, type App } from 'obsidian'

/** Creates a folder and everything above it, a segment at a time. */
export async function ensureFolder(app: App, folder: string): Promise<void> {
  const segments = folder.split('/').filter(segment => segment !== '')
  let path = ''
  for (const segment of segments) {
    path = path === '' ? segment : `${path}/${segment}`
    const existing = app.vault.getAbstractFileByPath(path)
    if (existing instanceof TFolder) continue
    // A note where the folder should be is the reader's, not ours to move.
    if (existing) throw new Error(`${path} is a note, not a folder`)
    await app.vault.createFolder(path)
  }
}

/** Every vault write a reader's setup can refuse goes through here: one notice, and `undefined`. */
export async function guardWrite<T>(
  notify: (message: string) => void,
  what: string,
  use: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await use()
  } catch (error) {
    notify(error instanceof Error ? `Could not write ${what}: ${error.message}` : `Could not write ${what}`)
    return undefined
  }
}
