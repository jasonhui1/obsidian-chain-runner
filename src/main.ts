import { Notice, Plugin, type WorkspaceLeaf } from 'obsidian'
import { EngineClient } from './engine/client'
import { createEngineGuard } from './engine/guard'
import { createNodeTransport } from './engine/nodeTransport'
import { EngineStatus } from './engine/status'
import { withDefaults, type ChainRunnerSettings } from './settings'
import { ChainNodes, newNodeId } from './ui/chainNodes'
import { createDrawingSurface, createNodeSurface, registerLinkHook } from './ui/excalidraw'
import { KeepPiece } from './ui/keepPiece'
import { QuickRunner } from './ui/quickRun'
import { RESULT_VIEW_TYPE, RunResultView } from './ui/resultView'
import { ChainRunnerSettingTab } from './ui/settingsTab'
import { renderStatusPill } from './ui/statusPill'

export default class ChainRunnerPlugin extends Plugin {
  // Obsidian declares `settings?: unknown` on Plugin for subclasses to narrow.
  declare settings: ChainRunnerSettings
  engine!: EngineClient
  status!: EngineStatus
  /** Wraps any action that needs the engine; offline means a notice and nothing else. */
  withEngine!: ReturnType<typeof createEngineGuard>

  private pill: HTMLElement | undefined
  private quickRun!: QuickRunner

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
    this.register(this.status.onChange(() => this.renderPill()))
    this.register(() => this.status.stop())
    this.status.start()

    const keep = new KeepPiece({
      app: this.app,
      notify: message => new Notice(message),
      folder: () => this.settings.outputFolder,
      drawing: createDrawingSurface(this.app),
    })
    this.registerView(
      RESULT_VIEW_TYPE,
      leaf =>
        new RunResultView(leaf, {
          saveAsNote: (panel, run) => void keep.saveAsNote(panel, run),
          sendToDrawing: (panel, run) => void keep.sendToDrawing(panel, run),
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

    const nodes = new ChainNodes({
      app: this.app,
      engine: this.engine,
      withEngine: action => this.withEngine(action),
      notify: message => new Notice(message),
      surface: createNodeSurface(this.app),
      newNodeId,
    })
    // Excalidraw is not necessarily loaded while this one is loading, and the
    // hook lives on its plugin instance — so it is installed once the workspace
    // has finished coming up rather than here. The disposer is registered now
    // rather than then: a plugin disabled before layout-ready would otherwise
    // install a hook after its own unload and never take it off again.
    let removeLinkHook: (() => void) | undefined
    let unloaded = false
    this.register(() => {
      unloaded = true
      removeLinkHook?.()
    })
    this.app.workspace.onLayoutReady(() => {
      if (unloaded) return
      removeLinkHook = registerLinkHook(this.app, (element, view) => nodes.handleLinkClick(element, view))
    })

    this.addSettingTab(new ChainRunnerSettingTab(this.app, this))

    this.addCommand({
      id: 'add-chain-node',
      name: 'Add chain node',
      callback: () => void nodes.add(),
    })

    this.addCommand({
      id: 'run-chain-on-note',
      name: 'Run chain on this note',
      callback: () => void this.quickRun.start(),
    })

    // The one action this ticket ships: proof the client reaches a live engine,
    // and the offline path something can be exercised against (#3).
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
   * The result view, opened in the right sidebar or brought back to the front.
   *
   * One view, reused: a second run replaces what the first showed rather than
   * stacking another tab beside it.
   */
  private async openResultView(): Promise<RunResultView | undefined> {
    const open = this.app.workspace.getLeavesOfType(RESULT_VIEW_TYPE)
    const leaf: WorkspaceLeaf | null = open[0] ?? this.app.workspace.getRightLeaf(false)
    if (!leaf) return undefined
    if (open.length === 0) await leaf.setViewState({ type: RESULT_VIEW_TYPE, active: false })
    await this.app.workspace.revealLeaf(leaf)
    return leaf.view instanceof RunResultView ? leaf.view : undefined
  }

  /**
   * Persists only. Re-checking the engine is the settings tab's call, made when
   * the URL box is left rather than on every keystroke.
   */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
    this.renderPill()
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
