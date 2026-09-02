/** Everything the plugin persists. One setting so far: where the engine lives. */
export interface ChainRunnerSettings {
  engineUrl: string
}

export const DEFAULT_SETTINGS: ChainRunnerSettings = {
  engineUrl: 'http://localhost:3000',
}

/**
 * Tidies what was typed into the settings box. Text that is not a URL is left
 * as typed rather than rewritten — the status pill going offline says more
 * about a typo than a silently corrected value would.
 */
export function normaliseEngineUrl(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') return DEFAULT_SETTINGS.engineUrl

  // `localhost:3000` parses as a URL whose scheme is `localhost:`, so a missing
  // scheme is detected by the absence of `//` rather than by a parse failure.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  try {
    const url = new URL(withScheme)
    return url.toString().replace(/\/$/, '')
  } catch {
    return trimmed
  }
}

/** Reads persisted data back, tolerating an absent or malformed file. */
export function withDefaults(saved: unknown): ChainRunnerSettings {
  const data = (saved ?? {}) as Partial<Record<keyof ChainRunnerSettings, unknown>>
  return {
    engineUrl: typeof data.engineUrl === 'string' ? data.engineUrl : DEFAULT_SETTINGS.engineUrl,
  }
}
