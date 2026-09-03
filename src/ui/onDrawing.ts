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
