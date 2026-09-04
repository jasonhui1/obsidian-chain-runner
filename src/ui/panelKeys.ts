import type { RunPanel } from '../run/panels'

/**
 * What names a panel across draws, so the view updates the element the panel
 * already has instead of rebuilding it (ADR-0007).
 *
 * A panel carries no id of its own: its node and its loop round are what stay
 * the same from one frame to the next. Two panels can share both — one node
 * feeding two ports — so a repeat is numbered by where it appears.
 */
export function panelKeys(panels: RunPanel[]): string[] {
  const seen = new Map<string, number>()
  return panels.map(panel => {
    const base = `${panel.node}|${panel.round ?? ''}|${panel.name}`
    const repeat = seen.get(base) ?? 0
    seen.set(base, repeat + 1)
    return repeat === 0 ? base : `${base}|${repeat}`
  })
}
