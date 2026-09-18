import type { NoteStore } from './noteStore'
import { seedFromNote, joinSeed } from '../run/seed'
import type { NodeInput } from './nodeScene'

/** Blocks on a drawing as one seed. Shared by every surface that reads a drawing. */

export const MISSING_NOTE = (linkpath: string): string => `${linkpath} is no longer in the vault, so it was skipped.`

/** The inputs as one piece of text; a note contributes its body, minus frontmatter. */
export async function seedFromInputs(input: {
  store: NoteStore
  notify: (message: string) => void
  inputs: readonly NodeInput[]
  /** The drawing's path, which a wiki link on it resolves against. */
  drawing: string
}): Promise<string> {
  const parts: string[] = []
  for (const one of input.inputs) {
    if (one.kind === 'text') {
      parts.push(one.text)
      continue
    }
    const path = input.store.resolveLink(one.linkpath, input.drawing)
    const text = path === undefined ? undefined : await input.store.read(path)
    if (text === undefined) {
      input.notify(MISSING_NOTE(one.linkpath))
      continue
    }
    parts.push(seedFromNote(text))
  }
  return joinSeed(parts)
}
