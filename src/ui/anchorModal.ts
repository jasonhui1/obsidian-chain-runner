import { PANEL, panelSpot, type Point } from './panelSpot'

/**
 * Opening a modal beside what it changes. Obsidian centres a modal in CSS, so
 * the class undoes that and the inline spot puts it where the click was
 * (ADR-0010).
 */

/** Carries the CSS that undims the drawing and lets the modal be positioned. */
const ANCHORED = 'chain-runner-anchored'

/** The part of an Obsidian modal this moves; both are on `Modal` itself. */
export interface AnchorableModal {
  containerEl: HTMLElement
  modalEl: HTMLElement
}

export function anchorModal(modal: AnchorableModal, at: Point): void {
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const spot = panelSpot(at, PANEL, viewport)
  modal.containerEl.addClass(ANCHORED)
  modal.modalEl.style.left = `${spot.left}px`
  modal.modalEl.style.top = `${spot.top}px`
  modal.modalEl.style.width = `${PANEL.width}px`
  modal.modalEl.style.maxHeight = `${PANEL.height}px`
}
