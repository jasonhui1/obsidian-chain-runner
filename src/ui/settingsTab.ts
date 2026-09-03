import { App, PluginSettingTab, Setting } from 'obsidian'
import { normaliseEngineUrl, normaliseOutputFolder } from '../settings'
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
        // Normalising mid-word would fight the cursor, so the field is rewritten
        // and the engine re-checked only once the box is left.
        text.inputEl.addEventListener('blur', () => {
          text.setValue(this.plugin.settings.engineUrl)
          void this.plugin.status.refresh()
        })
      })

    new Setting(containerEl)
      .setName('Output folder')
      .setDesc('Where a panel saved as a note goes. Each run gets a folder of its own inside it.')
      .addText(text => {
        text
          .setPlaceholder('chains/runs')
          .setValue(this.plugin.settings.outputFolder)
          .onChange(async value => {
            this.plugin.settings.outputFolder = normaliseOutputFolder(value)
            await this.plugin.saveSettings()
          })
        // Rewritten on blur, the same as the URL box above.
        text.inputEl.addEventListener('blur', () => {
          text.setValue(this.plugin.settings.outputFolder)
        })
      })
  }
}
