import { setIcon, type IconName } from 'obsidian'
import type { EngineState } from '../engine/status'

export interface PillContent {
  text: string
  tooltip: string
  /** Modifier appended to the pill's base class; drives colour only. */
  modifier: string
  /** Lucide, so the theme colours it the way it colours every other status item. */
  icon: IconName
}

/** What the status-bar pill says for a given state; `renderStatusPill` writes it. */
export function describeEngineState(state: EngineState, engineUrl: string): PillContent {
  switch (state) {
    case 'online':
      return { text: 'engine', tooltip: `Chain Runner: engine online at ${engineUrl}`, modifier: 'online', icon: 'link' }
    case 'offline':
      return { text: 'offline', tooltip: `Chain Runner: no engine at ${engineUrl}`, modifier: 'offline', icon: 'unlink' }
    case 'unknown':
      return { text: '…', tooltip: `Chain Runner: checking ${engineUrl}`, modifier: 'unknown', icon: 'loader' }
  }
}

export const PILL_CLASS = 'chain-runner-engine-pill'

const MODIFIERS = ['online', 'offline', 'unknown'] as const

/**
 * Writes the pill into the status-bar item, as an icon and a word — the shape
 * Obsidian's own status items use. Classes are toggled rather than assigned:
 * overwriting Obsidian's own would drop the pill out of the layout.
 */
export function renderStatusPill(el: HTMLElement, state: EngineState, engineUrl: string): void {
  const { text, tooltip, modifier, icon } = describeEngineState(state, engineUrl)
  el.empty()
  setIcon(el.createSpan({ cls: 'status-bar-item-icon' }), icon)
  el.createSpan({ cls: 'status-bar-item-segment', text })
  el.setAttribute('aria-label', tooltip)
  el.classList.add(PILL_CLASS)
  for (const candidate of MODIFIERS) {
    el.classList.toggle(`${PILL_CLASS}--${candidate}`, candidate === modifier)
  }
}
