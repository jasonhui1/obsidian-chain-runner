import { Notice, Plugin, type WorkspaceLeaf } from 'obsidian'
import { EngineClient } from './engine/client'
import { createEngineGuard } from './engine/guard'
import { createNodeTransport } from './engine/nodeTransport'
import { EngineStatus } from './engine/status'
import { seedFromNote } from './run/seed'
import { withDefaults, type ChainRunnerSettings } from './settings'
import { ChainNodes, newNodeId } from './ui/chainNodes'
import { AskTheRoom } from './ui/askTheRoom'
import { ChatWithProposer } from './ui/chatWithProposer'
import { DirectingView, DIRECTING_VIEW_TYPE } from './ui/directingView'
import { createDirectionButtons } from './ui/directionButtons'
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
import { DirectFromDrawing } from './ui/directFromDrawing'
import { DirectRun } from './ui/directRun'
import { HoldActions } from './ui/holdActions'
import { HoldNotes } from './ui/holdNotes'
import { KeepMarks } from './ui/keepMarks'
import { KeepPiece } from './ui/keepPiece'
import { MarkLinesModal } from './ui/markLines'
import { NodeRun } from './ui/nodeRun'
import { OutputNotes } from './ui/outputNotes'
import { QuickRunner } from './ui/quickRun'
import { RerunDownstream } from './ui/rerunDownstream'
import { RESULT_VIEW_TYPE, RunResultView } from './ui/resultView'
import { RunPanels } from './ui/runPanels'
import { Resume } from './ui/resume'
import { ChainRunnerSettingTab } from './ui/settingsTab'
import { SideQuest } from './ui/sideQuest'
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
    // Verb buttons next to each proposal in a hold note, a shortcut for the Direction block.
    this.registerMarkdownPostProcessor(
      createDirectionButtons({ app: this.app, notify: message => new Notice(message) }),
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
    this.registerDomEvent(
      document,
      'pointerup',
      event => {
        clicks.release(spot(event), Date.now())
        // A drag that resized a node is finished; its lines are re-cut now
        // rather than on every frame, because every write is a save (ADR-0011).
        nodes.handleResize()
      },
      { capture: true },
    )
    this.registerDomEvent(document, 'pointercancel', () => clicks.cancel(), { capture: true })
    // `▶ Run` without a modifier. Excalidraw's canvas captures the pointer, so
    // the browser's own `dblclick` never arrives; the presses are counted
    // instead (ADR-0010).
    clicks.onDouble(() => nodes.handleDoubleClick())

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
      now: () => Date.now(),
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

    const holdNotes = new HoldNotes({ app: this.app, notify: message => new Notice(message) })
    const directRun = new DirectRun({
      engine: this.engine,
      withEngine: action => this.withEngine(action),
      notify: message => new Notice(message),
      holdNotes,
      currentRun: () => this.activeResultView()?.currentResult(),
      open: note => this.app.workspace.getLeaf('tab').openFile(note),
    })
    // From the drawing, a hold opens in the directing panel rather than a tab.
    const directInPanel = new DirectRun({
      engine: this.engine,
      withEngine: action => this.withEngine(action),
      notify: message => new Notice(message),
      holdNotes,
      currentRun: () => undefined,
      open: async (_note, runId) => void (await this.openDirectingPanel())?.show(runId),
    })
    const chat = new ChatWithProposer({
      app: this.app,
      engine: this.engine,
      withEngine: action => this.withEngine(action),
      notify: message => new Notice(message),
    })
    const askRoom = new AskTheRoom({
      app: this.app,
      engine: this.engine,
      withEngine: action => this.withEngine(action),
      notify: message => new Notice(message),
    })
    const rerun = new RerunDownstream({
      app: this.app,
      engine: this.engine,
      withEngine: action => this.withEngine(action),
      notify: message => new Notice(message),
    })
    const holds = new HoldActions({
      app: this.app,
      notify: message => new Notice(message),
      notes: holdNotes,
      write: runId => directInPanel.write(runId),
      chat,
      room: askRoom,
      rerun,
      panels: new RunPanels(this.engine),
    })
    this.registerView(DIRECTING_VIEW_TYPE, leaf => new DirectingView(leaf, holds))
    const directFromDrawing = new DirectFromDrawing({
      surface: {
        unavailable: () => surface.unavailable(),
        selectedRun: () => surface.selectedRun(),
        cardProposal: (element, view) => surface.cardProposal(element, view),
      },
      direct: runId => directInPanel.openHold(runId),
      showProposal: async (runId, proposal) => void (await this.openDirectingPanel())?.show(runId, proposal),
      notify: message => new Notice(message),
      clickSpot: settled => clicks.onSettled(settled),
    })

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
        [expand, nodes, directFromDrawing].every(handler => handler.handleLinkClick(element, view)),
      )
      // A plain click reaches a node and a run's Direct label; a proposal's
      // decisions stay on the link hook, where nothing is written without the reader saying so.
      removeSelectionHook = registerSelectionHook(this.app, {
        clicked: (element, view) => {
          nodes.handleSelection(element, view)
          directFromDrawing.handleSelection(element, view)
        },
        editing: (element, view) => nodes.handleTextEdit(element, view),
      })
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

    this.addCommand({
      id: 'direct-this-run',
      name: 'Direct this run',
      callback: () => void directRun.start(),
    })

    this.addCommand({
      id: 'open-directing-panel',
      name: 'Open the directing panel',
      callback: () => void this.openDirectingPanel(),
    })

    this.addCommand({
      id: 'direct-selected-run',
      name: 'Direct the selected run',
      callback: () => void directFromDrawing.directSelected(),
    })

    const resume = new Resume({
      app: this.app,
      engine: this.engine,
      withEngine: action => this.withEngine(action),
      notify: message => new Notice(message),
      engineUrl: () => this.settings.engineUrl,
    })

    this.addCommand({
      id: 'resume-hold',
      name: 'Resume this hold',
      callback: () => void resume.start(),
    })

    this.addCommand({
      id: 'rerun-downstream',
      name: 'Rerun downstream',
      callback: () => void rerun.start(),
    })

    this.addCommand({
      id: 'chat-with-proposer',
      name: 'Chat with proposer',
      callback: () => void chat.start(),
    })

    this.addCommand({
      id: 'ask-the-room',
      name: 'Ask the room',
      callback: () => void askRoom.start(),
    })

    const sideQuest = new SideQuest({
      app: this.app,
      engine: this.engine,
      withEngine: action => this.withEngine(action),
      notify: message => new Notice(message),
      engineUrl: () => this.settings.engineUrl,
    })

    this.addCommand({
      id: 'side-quest',
      name: 'Side quest',
      callback: () => void sideQuest.start(),
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

  /** The directing panel in the right sidebar, opened or brought to the front. */
  private async openDirectingPanel(): Promise<DirectingView | undefined> {
    const open = this.app.workspace.getLeavesOfType(DIRECTING_VIEW_TYPE)
    const leaf: WorkspaceLeaf | null = open[0] ?? this.app.workspace.getRightLeaf(false)
    if (!leaf) return undefined
    if (open.length === 0) await leaf.setViewState({ type: DIRECTING_VIEW_TYPE, active: false })
    await this.app.workspace.revealLeaf(leaf)
    return leaf.view instanceof DirectingView ? leaf.view : undefined
  }

  /** The result view already open, if any — this never opens one of its own. */
  private activeResultView(): RunResultView | undefined {
    const leaf = this.app.workspace.getLeavesOfType(RESULT_VIEW_TYPE)[0]
    return leaf?.view instanceof RunResultView ? leaf.view : undefined
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
