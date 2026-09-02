import type { RunPanel } from '../run/layout'
import type { RunStatus } from '../run/session'

/**
 * What a panel says when it has nothing to show, and the one thing that says it.
 *
 * The wording is the engine's result view's, so the same run reads the same on
 * both surfaces. `tone` names the condition rather than a colour; the stylesheet
 * decides what that looks like, in whichever theme is on.
 */
export type PanelTone = 'writing' | 'waiting' | 'empty' | 'errored' | 'skipped'

export interface PanelNotice {
  text: string
  tone: PanelTone
}

/** The three outcomes a settled hop can leave a panel in. */
const NOTICE: Record<'empty' | 'errored' | 'skipped', PanelNotice> = {
  empty: { text: 'nothing survived — this hop dropped the section the chain asked it for', tone: 'empty' },
  errored: { text: 'this hop failed', tone: 'errored' },
  skipped: { text: 'skipped — the branch went the other way', tone: 'skipped' },
}

export function noticeFor(panel: RunPanel, status: RunStatus): PanelNotice | null {
  if (panel.state === 'filled') return null
  // Text on screen already says the hop is working; the cue only names what it is.
  if (panel.streaming) return { text: 'writing…', tone: 'writing' }
  // A settled run has nothing left to wait for, so a pending panel here is a node
  // that never ran rather than one still coming.
  if (panel.state === 'pending') {
    return { text: status === 'running' ? 'waiting' : 'never ran', tone: 'waiting' }
  }
  const notice = NOTICE[panel.state]
  return panel.error ? { ...notice, text: `${notice.text} — ${panel.error}` } : notice
}
