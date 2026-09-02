import { App, SuggestModal } from 'obsidian'
import type { DrawingChoice, DrawingReason } from './drawingChoices'

/**
 * Which drawing to send a piece to. The order is the point — the drawing on
 * screen is nearly always the answer — so the list opens unfiltered and the
 * search is there for the vault where it is not.
 */

/** Why a drawing sits where it does, said plainly under its name. */
const REASON: Record<DrawingReason, string> = {
  open: 'open now',
  recent: 'opened recently',
  other: '',
}

export class DrawingPicker extends SuggestModal<DrawingChoice> {
  constructor(
    app: App,
    private readonly drawings: DrawingChoice[],
    private readonly onPick: (drawing: DrawingChoice) => void,
  ) {
    super(app)
    this.setPlaceholder('Send it to which drawing?')
    this.emptyStateText = 'No drawing matches'
    this.limit = 100
  }

  getSuggestions(query: string): DrawingChoice[] {
    const needle = query.trim().toLowerCase()
    if (needle === '') return this.drawings
    // The path is matched as well as the name, so a vault that files drawings by
    // folder can be searched by folder.
    return this.drawings.filter(drawing => drawing.path.toLowerCase().includes(needle))
  }

  renderSuggestion(drawing: DrawingChoice, el: HTMLElement): void {
    el.addClass('chain-runner-suggestion')
    el.createDiv({ cls: 'chain-runner-suggestion-name', text: drawing.name })
    const note = REASON[drawing.reason] || drawing.path
    el.createDiv({ cls: 'chain-runner-suggestion-note', text: note })
  }

  onChooseSuggestion(drawing: DrawingChoice): void {
    this.onPick(drawing)
  }
}
