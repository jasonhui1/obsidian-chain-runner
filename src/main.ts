import { Notice, Plugin, type ItemView, type WorkspaceLeaf } from 'obsidian'
import { EngineClient } from './engine/client'
import { createEngineGuard } from './engine/guard'
import { createNodeTransport } from './engine/nodeTransport'
import { EngineStatus } from './engine/status'
import { runViewUrl } from './run/provenance'
import { RerunWatch } from './run/rerunWatch'
import { seedFromNote } from './run/seed'
import { withDefaults, type ChainRunnerSettings } from './settings'
import { ChainNodes, newNodeId } from './ui/chainNodes'
import { DirectingView, DIRECTING_VIEW_TYPE } from './ui/directingView'
import { createDirectionButtons } from './ui/directionButtons'
import {
  createDrawingSurface,
  createExcalidrawSurface,
  createScriptVault,
  registerLinkHook,
  registerSelectionHook,
  scriptFolder,
  type DrawingView,
} from './ui/excalidraw'
import { Expand, newProposalId } from './ui/expand'
import { PointerClicks } from './ui/pointerClicks'
import { DirectFromDrawing } from './ui/directFromDrawing'
import { directRun, rerunDownstreamFront, resumeFront, sendFront } from './ui/holdCommands'
import { Holds } from './ui/holds'
import { KeepMarks } from './ui/keepMarks'
import { KeepPiece } from './ui/keepPiece'
import { MarkLinesModal } from './ui/markLines'
import { createNoteStore, readFront, type NoteStore } from './ui/noteStore'
import { NodeRun } from './ui/nodeRun'
import { OutputNotes } from './ui/outputNotes'
import { QuickRunner } from './ui/quickRun'
import { RerunOnDrawing } from './ui/rerunOnDrawing'
import { RESULT_VIEW_TYPE, RunResultView } from './ui/resultView'
import { VARIANCE_VIEW_TYPE, VarianceView } from './ui/varianceView'
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
    const store = createNoteStore(this.app)
    const notify = (message: string): void => void new Notice(message)
    const markOffline = (): void => this.status.markOffline()
    this.withEngine = createEngineGuard({
      refresh: () => this.status.refresh(),
      notify,
      markOffline,
    })
    const sharedDeps = {
      notify,
      withEngine: this.withEngine,
      engineUrl: (): string => this.settings.engineUrl,
      markOffline,
    }

    this.pill = this.addStatusBarItem()
    this.renderPill()
    this.register(
      this.status.onChange(state => {
        // An engine that came back may be another version: what it can do is asked again.
        // A refresh that fails keeps what was known; the action that needs it will say so.
        if (state === 'online') this.engine.loadWorkspace().catch(() => {})
        this.renderPill()
        // The empty result view says whether there is an engine, so it moves with the pill.
        this.refreshResultViews()
      }),
    )
    this.register(() => this.status.stop())
    this.status.start()

    // One writer for the output-note convention, so a panel kept twice is one note.
    const notes = new OutputNotes({
      store,
      ...sharedDeps,
      folder: () => this.settings.outputFolder,
    })
    // Every rerun reports here, wherever it was started.
    const reruns = new RerunWatch()
    // Every rendering of an output note says which run wrote it (ADR-0004), and what a rerun is doing to it.
    const sourceRun = createSourceRunHeader({
      ...sharedDeps,
      exists: runId => this.engine.runExists(runId),
      reruns,
    })
    this.registerMarkdownPostProcessor(sourceRun.processor)
    this.register(sourceRun.stop)
    // The one owner of every hold note: the panel, the palette and the buttons all go through it.
    const runUrl = (runId: string): string | undefined => runViewUrl(sharedDeps.engineUrl(), runId)
    const holds = new Holds({
      store,
      engine: this.engine,
      ...sharedDeps,
      reruns,
      runUrl,
    })
    // Verb buttons next to each proposal in a hold note, a shortcut for the Direction block.
    this.registerMarkdownPostProcessor(createDirectionButtons({ app: this.app, holds }))
    const keep = new KeepPiece({
      app: this.app,
      store,
      ...sharedDeps,
      notes,
      drawing: createDrawingSurface(this.app),
    })
    const marks = new KeepMarks({
      app: this.app,
      store,
      ...sharedDeps,
      notes,
      mark: (text, onDone) => new MarkLinesModal(this.app, text, onDone).open(),
      runChain: ({ text, source }) => void this.quickRun.runOn({ text, from: 'marks' }, source),
    })
    this.registerView(
      RESULT_VIEW_TYPE,
      leaf =>
        new RunResultView(leaf, () => ({ state: this.status.state, url: sharedDeps.engineUrl() }), {
          saveAsNote: (panel, run) => void keep.saveAsNote(panel, run),
          sendToDrawing: (panel, run) => void keep.sendToDrawing(panel, run),
          keepLines: (panel, run) => marks.start({ kind: 'panel', text: panel.text, panel, run }),
      }),
    )
    this.registerView(
      VARIANCE_VIEW_TYPE,
      leaf => new VarianceView(leaf, groupId => void this.openVarianceGroup(groupId)),
    )
    // A run watched live writes its hold note as it reaches each hold.
    const holdReached = async (runId: string, nodeId: string): Promise<void> => {
      if (await holds.write(runId)) notify(`Run ${runId} is waiting at ${nodeId}: its hold note is written`)
    }
    this.quickRun = new QuickRunner({
      app: this.app,
      store,
      engine: this.engine,
      ...sharedDeps,
      openResultView: () =>
        this.openSidebarView(RESULT_VIEW_TYPE, (view): view is RunResultView => view instanceof RunResultView),
      openVarianceView: () =>
        this.openSidebarView(VARIANCE_VIEW_TYPE, (view): view is VarianceView => view instanceof VarianceView),
      holdReached,
    })
    // A run outlives the command that started it; unloading the plugin ends it.
    this.register(() => this.quickRun.stop())

    const surface = createExcalidrawSurface(this.app)
    // A rerun that lands moves the cards on every open drawing on to the run it landed as.
    const onDrawing = new RerunOnDrawing({ surface, notes, ...sharedDeps })
    this.register(reruns.onLanding(landing => onDrawing.land(landing)))
    const nodeRun = new NodeRun({
      store,
      engine: this.engine,
      ...sharedDeps,
      holdReached,
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
      ...sharedDeps,
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
      store,
      engine: this.engine,
      ...sharedDeps,
      holdReached,
      surface,
      notes,
      newProposalId,
    })
    // An expansion outlives the command that started it; unloading the plugin ends it.
    this.register(() => expand.stop())

    this.registerView(
      DIRECTING_VIEW_TYPE,
      leaf =>
        new DirectingView(leaf, {
          holds,
          reruns,
          chains: () => this.engine.listChains().then(
            chains => chains.map(chain => chain.name),
            () => [],
          ),
          runUrl,
        }),
    )
    // From the drawing, a hold opens in the directing panel, brought up to date or written first.
    const showOnPanel = async (runId: string, proposal?: string): Promise<void> => {
      const hold = (await holds.refresh(runId)) ?? (await holds.write(runId))
      const panel = await this.openSidebarView(
        DIRECTING_VIEW_TYPE,
        (view): view is DirectingView => view instanceof DirectingView,
      )
      panel?.show(runId, hold, proposal)
    }
    const directFromDrawing = new DirectFromDrawing({
      surface,
      direct: runId => showOnPanel(runId),
      showProposal: (runId, proposal) => showOnPanel(runId, proposal),
      ...sharedDeps,
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
          notify('Chain Runner could not write its Excalidraw toolbar script.')
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
      callback: () => void this.markLines(store, marks, notify),
    })

    this.addCommand({
      id: 'direct-this-run',
      name: 'Direct this run',
      callback: () => void directRun(holds, notify, this.activeResultView()?.currentResult()),
    })

    this.addCommand({
      id: 'open-directing-panel',
      name: 'Open the directing panel',
      callback: () =>
        void this.openSidebarView(
          DIRECTING_VIEW_TYPE,
          (view): view is DirectingView => view instanceof DirectingView,
        ),
    })

    this.addCommand({
      id: 'direct-selected-run',
      name: 'Direct the selected run',
      callback: () => void directFromDrawing.directSelected(),
    })

    this.addCommand({
      id: 'resume-hold',
      name: 'Resume this hold',
      callback: () => void resumeFront(holds, notify),
    })

    this.addCommand({
      id: 'rerun-downstream',
      name: 'Rerun downstream',
      callback: () => void rerunDownstreamFront(holds, notify),
    })

    this.addCommand({
      id: 'chat-with-proposer',
      name: 'Chat with proposer',
      callback: () => void sendFront(holds, notify, 'chat'),
    })

    this.addCommand({
      id: 'ask-the-room',
      name: 'Ask the room',
      callback: () => void sendFront(holds, notify, 'room'),
    })

    this.addCommand({
      id: 'side-quest',
      name: 'Side quest',
      callback: () => void sendFront(holds, notify, 'quest'),
    })

    // Proof the client reaches a live engine, and something to exercise the
    // offline path against (#3).
    this.addCommand({
      id: 'list-chains',
      name: 'List chains on the engine',
      callback: () => {
        void sharedDeps.withEngine(async () => {
          const chains = await this.engine.listChains()
          notify(chains.length === 0 ? 'No chains in the workspace' : `${chains.length} chains: ${names(chains)}`)
        })
      },
    })
  }

  /**
   * What the Excalidraw toolbar script calls — this plugin's one caller from
   * outside it. The view is the drawing the button was pressed on.
   */
  addChainNode(view?: DrawingView): Promise<void> {
    return this.nodes.placeUnset(view)
  }

  /**
   * Marks lines of the note in front of the reader. Frontmatter comes off first,
   * as it does for a run: it is the vault's bookkeeping, not the note's words.
   */
  private async markLines(
    store: NoteStore,
    marks: KeepMarks,
    notify: (message: string) => void,
  ): Promise<void> {
    const note = await readFront(store)
    if (!note) {
      notify('Open a note to mark lines in it')
      return
    }
    marks.start({ kind: 'note', text: seedFromNote(note.content), path: note.path })
  }

  /** Opens the sidebar view in the right leaf or brings its existing leaf forward. */
  private async openSidebarView<TView extends ItemView>(
    type: string,
    isView: (view: unknown) => view is TView,
  ): Promise<TView | undefined> {
    const open = this.app.workspace.getLeavesOfType(type)
    const leaf: WorkspaceLeaf | null = open[0] ?? this.app.workspace.getRightLeaf(false)
    if (!leaf) return undefined
    if (open.length === 0) await leaf.setViewState({ type, active: false })
    await this.app.workspace.revealLeaf(leaf)
    return isView(leaf.view) ? leaf.view : undefined
  }

  /** Opens a member's variance group from its run detail and refreshes it from the engine. */
  private async openVarianceGroup(groupId: string): Promise<void> {
    const capabilities = await this.withEngine(() => this.engine.capabilities())
    if (!capabilities) return
    if (capabilities.varianceGroups !== true) {
      new Notice('This engine no longer supports variance groups')
      return
    }
    const view = await this.openSidebarView(
      VARIANCE_VIEW_TYPE,
      (candidate): candidate is VarianceView => candidate instanceof VarianceView,
    )
    if (!view) {
      new Notice('No room in the sidebar for the variance group')
      return
    }
    const group = await this.withEngine(() => this.engine.getVarianceGroup(groupId))
    if (group) view.showGroup(group)
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
