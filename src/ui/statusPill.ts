import type { EngineState } from '../engine/status'

export interface PillContent {
  text: string
  tooltip: string
  /** Modifier appended to the pill's base class; drives colour only. */
  modifier: string
}

/** What the status-bar pill says for a given state; `renderStatusPill` writes it. */
export function describeEngineState(state: EngineState, engineUrl: string): PillContent {
  switch (state) {
    case 'online':
      return { text: '⛓ engine', tooltip: `Chain Runner: engine online at ${engineUrl}`, modifier: 'online' }
    case 'offline':
      return { text: '⛓ offline', tooltip: `Chain Runner: no engine at ${engineUrl}`, modifier: 'offline' }
    case 'unknown':
      return { text: '⛓ …', tooltip: `Chain Runner: checking ${engineUrl}`, modifier: 'unknown' }
  }
}

export const PILL_CLASS = 'chain-runner-engine-pill'

const MODIFIERS = ['online', 'offline', 'unknown'] as const

/**
 * Writes the pill into the status-bar item. Classes are toggled rather than
 * assigned: overwriting Obsidian's own would drop the pill out of the layout.
 */
export function renderStatusPill(el: HTMLElement, state: EngineState, engineUrl: string): void {
  const { text, tooltip, modifier } = describeEngineState(state, engineUrl)
  el.textContent = text
  el.setAttribute('aria-label', tooltip)
  el.classList.add(PILL_CLASS)
  for (const candidate of MODIFIERS) {
    el.classList.toggle(`${PILL_CLASS}--${candidate}`, candidate === modifier)
  }
}
