import { Notice, Plugin } from 'obsidian'
import { EngineClient } from './engine/client'
import { createEngineGuard } from './engine/guard'
import { createNodeTransport } from './engine/nodeTransport'
import { EngineStatus } from './engine/status'
import { withDefaults, type ChainRunnerSettings } from './settings'
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

    this.addSettingTab(new ChainRunnerSettingTab(this.app, this))

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
