import { Notice, Plugin, type WorkspaceLeaf } from 'obsidian'
import { EngineClient } from './engine/client'
import { createEngineGuard } from './engine/guard'
import { createNodeTransport } from './engine/nodeTransport'
import { EngineStatus } from './engine/status'
import { seedFromNote } from './run/seed'
import { withDefaults, type ChainRunnerSettings } from './settings'
import { ChainNodes, newNodeId } from './ui/chainNodes'
import {
  createDrawingSurface,
  createNodeSurface,
  createScriptVault,
  registerLinkHook,
  registerSelectionHook,
  scriptFolder,
} from './ui/excalidraw'
import { Expand, newProposalId } from './ui/expand'
import { PointerClicks } from './ui/pointerClicks'
import { KeepMarks } from './ui/keepMarks'
import { KeepPiece } from './ui/keepPiece'
import { MarkLinesModal } from './ui/markLines'
import { NodeRun } from './ui/nodeRun'
import { OutputNotes } from './ui/outputNotes'
import { QuickRunner } from './ui/quickRun'
import { RESULT_VIEW_TYPE, RunResultView } from './ui/resultView'
import { ChainRunnerSettingTab } from './ui/settingsTab'
import { createSourceRunHeader } from './ui/sourceRunHeader'
import { renderStatusPill } from './ui/statusPill'
import { installScript } from './ui/toolScript'

export default class ChainRunnerPlugin extends Plugin {
  // Obsidian declares `settings?: unknown` on Plugin for subclasses to narrow.
  declare settings: ChainRunnerSettings
  engine!: EngineClient
  status!: EngineStatus
  /** Wraps any action that needs the engine; offline means a notice and nothing else. */
  withEngine!: ReturnType<typeof createEngineGuard>

  private pill: HTMLElement | undefined
  private quickRun!: QuickRunner
  private nodes!: ChainNodes

  override async onload(): Promise<void> {
    this.settings = withDefaults(await this.loadData())
    this.engine = new EngineClient(() => this.settings.engineUrl, createNodeTransport())
    this.status = new EngineStatus(() => this.engine.ping())
    this.withEngine = createEngineGuard({
      refresh: () => this.status.refresh(),
      notify: message => new Notice(message),
      markOffline: () => this.status.markOffline(),
    })

    this.pill = this.addStatusBarItem()
    this.renderPill()
    this.register(
      this.status.onChange(() => {
        this.renderPill()
        // The empty result view says whether there is an engine, so it moves with the pill.
        this.refreshResultViews()
      }),
    )
    this.register(() => this.status.stop())
    this.status.start()

    // One writer for the output-note convention, so a panel kept twice is one note.
    const notes = new OutputNotes({
      app: this.app,
      notify: message => new Notice(message),
      folder: () => this.settings.outputFolder,
      engineUrl: () => this.settings.engineUrl,
    })
    // Every rendering of an output note says which run wrote it (ADR-0004).
    this.registerMarkdownPostProcessor(
      createSourceRunHeader({
        engineUrl: () => this.settings.engineUrl,
        exists: runId => this.engine.runExists(runId),
      }),
    )
    const keep = new KeepPiece({
      app: this.app,
      notify: message => new Notice(message),
      notes,
      drawing: createDrawingSurface(this.app),
    })
    const marks = new KeepMarks({
      app: this.app,
      notify: message => new Notice(message),
      notes,
      mark: (text, onDone) => new MarkLinesModal(this.app, text, onDone).open(),
      runChain: ({ text, source }) => void this.quickRun.runOn({ text, from: 'marks' }, source),
    })
    this.registerView(
      RESULT_VIEW_TYPE,
      leaf =>
        new RunResultView(leaf, () => ({ state: this.status.state, url: this.settings.engineUrl }), {
          saveAsNote: (panel, run) => void keep.saveAsNote(panel, run),
          sendToDrawing: (panel, run) => void keep.sendToDrawing(panel, run),
          keepLines: (panel, run) => marks.start({ kind: 'panel', text: panel.text, panel, run }),
        }),
    )
    this.quickRun = new QuickRunner({
      app: this.app,
      engine: this.engine,
      withEngine: action => this.withEngine(action),
      openResultView: () => this.openResultView(),
      notify: message => new Notice(message),
      markOffline: () => this.status.markOffline(),
    })
    // A run outlives the command that started it; unloading the plugin ends it.
    this.register(() => this.quickRun.stop())

    const surface = createNodeSurface(this.app)
    const nodeRun = new NodeRun({
      app: this.app,
      engine: this.engine,
      withEngine: action => this.withEngine(action),
      notify: message => new Notice(message),
      markOffline: () => this.status.markOffline(),
      surface,
      notes,
    })
    // A run outlives the click that started it; unloading the plugin ends it.
    this.register(() => nodeRun.stop())

    // A selection hook carries no event, so the press behind it is read from
    // here; capture, because Excalidraw's canvas stops its own (ADR-0010).
    const clicks = new PointerClicks(() => Date.now())
    const spot = (event: PointerEvent): { x: number; y: number } => ({ x: event.clientX, y: event.clientY })
    this.registerDomEvent(document, 'pointerdown', event => clicks.press(spot(event), Date.now()), { capture: true })
    this.registerDomEvent(document, 'pointerup', event => clicks.release(spot(event), Date.now()), { capture: true })
    this.registerDomEvent(document, 'pointercancel', () => clicks.cancel(), { capture: true })

    const nodes = (this.nodes = new ChainNodes({
      app: this.app,
      engine: this.engine,
      withEngine: action => this.withEngine(action),
      notify: message => new Notice(message),
      surface,
      newNodeId,
      run: (data, element, view) => void nodeRun.run(data, element, view),
      isRunning: nodeId => nodeRun.isRunning(nodeId),
      clickSpot: settled => clicks.onSettled(settled),
      pressSpot: () => clicks.pressed(),
    }))
    const expand = new Expand({
      app: this.app,
      engine: this.engine,
      withEngine: action => this.withEngine(action),
      notify: message => new Notice(message),
      markOffline: () => this.status.markOffline(),
      surface,
      notes,
      newProposalId,
    })
    // An expansion outlives the command that started it; unloading the plugin ends it.
    this.register(() => expand.stop())

    // The hook lives on Excalidraw's plugin instance, which may not be loaded
    // yet; the disposer is registered now so an unload before layout-ready wins.
    let removeLinkHook: (() => void) | undefined
    let removeSelectionHook: (() => void) | undefined
    let unloaded = false
    this.register(() => {
      unloaded = true
      removeLinkHook?.()
      removeSelectionHook?.()
    })
    this.app.workspace.onLayoutReady(() => {
      if (unloaded) return
      // Each handler claims its own links and passes on what is not its; a
      // proposal's labels and a chain node's lines never overlap.
      removeLinkHook = registerLinkHook(this.app, (element, view) =>
        [expand, nodes].every(handler => handler.handleLinkClick(element, view)),
      )
      // A plain click reaches only the node; a proposal's decisions stay on the
      // link hook, where nothing is written without the reader saying so.
      removeSelectionHook = registerSelectionHook(this.app, (element, view) => nodes.handleSelection(element, view))
      // The toolbar button is a file in the vault, and Excalidraw names the folder.
      const folder = scriptFolder(this.app)
      if (folder) {
        void installScript(createScriptVault(this.app), folder).catch(() => {
          new Notice('Chain Runner could not write its Excalidraw toolbar script.')
        })
      }
    })

    this.addSettingTab(new ChainRunnerSettingTab(this.app, this))

    this.addCommand({
      id: 'add-chain-node',
      name: 'Add chain node',
      callback: () => void nodes.add(),
    })

    this.addCommand({
      id: 'expand-block',
      name: 'Expand this block with a chain',
      callback: () => void expand.start(),
    })

    // Following a link needs Ctrl/Cmd+Click (`docs/spike-ea.md`, Q1), so a
    // proposal's two decisions are in the palette as well as on the card.
    this.addCommand({
      id: 'keep-proposal',
      name: 'Keep the selected proposal',
      callback: () => void expand.decideSelected('accept'),
    })

    this.addCommand({
      id: 'drop-proposal',
      name: 'Drop the selected proposal',
      callback: () => void expand.decideSelected('dismiss'),
    })

    this.addCommand({
      id: 'run-chain-on-note',
      name: 'Run chain on this note',
      callback: () => void this.quickRun.start(),
    })

    this.addCommand({
      id: 'mark-lines-to-keep',
      name: 'Mark lines to keep in this note',
      callback: () => void this.markLines(marks),
    })

    // Proof the client reaches a live engine, and something to exercise the
    // offline path against (#3).
    this.addCommand({
      id: 'list-chains',
      name: 'List chains on the engine',
      callback: () => {
        void this.withEngine(async () => {
          const chains = await this.engine.listChains()
          new Notice(chains.length === 0 ? 'No chains in the workspace' : `${chains.length} chains: ${names(chains)}`)
        })
      },
    })
  }

  /**
   * What the Excalidraw toolbar script calls — this plugin's one caller from
   * outside it. The view is the drawing the button was pressed on.
   */
  addChainNode(view?: unknown): Promise<void> {
    return this.nodes.placeUnset(view)
  }

  /**
   * Marks lines of the note in front of the reader. Frontmatter comes off first,
   * as it does for a run: it is the vault's bookkeeping, not the note's words.
   */
  private async markLines(marks: KeepMarks): Promise<void> {
    const file = this.app.workspace.getActiveFile()
    if (!file || file.extension !== 'md') {
      new Notice('Open a note to mark lines in it')
      return
    }
    const text = seedFromNote(await this.app.vault.cachedRead(file))
    marks.start({ kind: 'note', text, file })
  }

  /**
   * The result view, opened in the right sidebar or brought to the front. One
   * view, reused: a second run replaces what the first showed.
   */
  private async openResultView(): Promise<RunResultView | undefined> {
    const open = this.app.workspace.getLeavesOfType(RESULT_VIEW_TYPE)
    const leaf: WorkspaceLeaf | null = open[0] ?? this.app.workspace.getRightLeaf(false)
    if (!leaf) return undefined
    if (open.length === 0) await leaf.setViewState({ type: RESULT_VIEW_TYPE, active: false })
    await this.app.workspace.revealLeaf(leaf)
    return leaf.view instanceof RunResultView ? leaf.view : undefined
  }

  private refreshResultViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(RESULT_VIEW_TYPE)) {
      if (leaf.view instanceof RunResultView) leaf.view.refresh()
    }
  }

  /** Persists only; re-checking the engine is the settings tab's call. */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
    this.renderPill()
    // The engine URL is named in the offline empty state.
    this.refreshResultViews()
  }

  private renderPill(): void {
    if (this.pill) renderStatusPill(this.pill, this.status.state, this.settings.engineUrl)
  }
}

function names(chains: { name: string }[]): string {
  return chains
    .slice(0, 5)
    .map(chain => chain.name)
    .join(', ')
}
