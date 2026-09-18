/** Touching a drawing, for the actions that do: a failure is a notice, not a throw. */

export const UNREACHABLE_DRAWING = 'Could not reach that drawing'

/** Runs `action` against a drawing. `undefined` means it could not be reached. */
export async function onDrawing<T>(
  action: () => Promise<T>,
  notify: (message: string) => void,
): Promise<T | undefined> {
  try {
    return await action()
  } catch (error) {
    notify(error instanceof Error ? error.message : UNREACHABLE_DRAWING)
    return undefined
  }
}

/** `onDrawing` for what answers at once: binding a drawing, or reading it. */
export function readDrawing<T>(read: () => T | undefined, notify: (message: string) => void): T | undefined {
  try {
    return read()
  } catch (error) {
    notify(error instanceof Error ? error.message : UNREACHABLE_DRAWING)
    return undefined
  }
}
