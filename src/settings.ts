/** Everything the plugin persists: where the engine lives, and where notes it writes go. */
export interface ChainRunnerSettings {
  engineUrl: string
  /** Output notes go here, in a folder per run named for the run id. */
  outputFolder: string
}

export const DEFAULT_SETTINGS: ChainRunnerSettings = {
  engineUrl: 'http://localhost:3000',
  outputFolder: 'chains/runs',
}

/**
 * Tidies the output-folder box: end slashes off so the path joins cleanly, and
 * an empty box means the default rather than the vault root.
 */
export function normaliseOutputFolder(raw: string): string {
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, '')
  return trimmed === '' ? DEFAULT_SETTINGS.outputFolder : trimmed
}

/**
 * Tidies the engine-URL box. Text that is not a URL is left as typed: the pill
 * going offline says more about a typo than a silent correction would.
 */
export function normaliseEngineUrl(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') return DEFAULT_SETTINGS.engineUrl

  // `localhost:3000` parses with scheme `localhost:`, so a missing scheme shows
  // as the absence of `//` rather than as a parse failure.
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
    outputFolder: typeof data.outputFolder === 'string' ? data.outputFolder : DEFAULT_SETTINGS.outputFolder,
  }
}
