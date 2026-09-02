import { App, PluginSettingTab, Setting } from 'obsidian'
import { normaliseEngineUrl } from '../settings'
import type ChainRunnerPlugin from '../main'

export class ChainRunnerSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: ChainRunnerPlugin,
  ) {
    super(app, plugin)
  }

  override display(): void {
    const { containerEl } = this
    containerEl.empty()

    new Setting(containerEl)
      .setName('Engine URL')
      .setDesc('Where maestro-playground is running. The status bar says whether it answers.')
      .addText(text => {
        text
          .setPlaceholder('http://localhost:3000')
          .setValue(this.plugin.settings.engineUrl)
          .onChange(async value => {
            this.plugin.settings.engineUrl = normaliseEngineUrl(value)
            await this.plugin.saveSettings()
          })
        // A half-typed URL is not worth a request, and normalising mid-word
        // would fight the cursor — so the engine is re-checked, and the field
        // rewritten to what was stored, only once the box is left.
        text.inputEl.addEventListener('blur', () => {
          text.setValue(this.plugin.settings.engineUrl)
          void this.plugin.status.refresh()
        })
      })
  }
}
