/**
 * 插件设置：排除标题等
 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import type FullContentMindMapPlugin from './main';

export interface MindMapSettings {
  /** 生成思维导图时要排除的标题（按标题文本匹配，大小写不敏感，双链取显示文本） */
  excludedHeadings: string[];
}

export const DEFAULT_SETTINGS: MindMapSettings = {
  excludedHeadings: ['相关链接'],
};

export class MindMapSettingTab extends PluginSettingTab {
  plugin: FullContentMindMapPlugin;

  constructor(app: App, plugin: FullContentMindMapPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h3', { text: '思维导图设置' });

    new Setting(containerEl)
      .setName('排除标题')
      .setDesc(
        '这些标题及其下方的所有内容不会出现在思维导图中，直到遇到同级或更高级的标题。' +
        '每行一个，按标题文本匹配（大小写不敏感；[[双链]]按显示文本匹配）。'
      )
      .addTextArea((text) => {
        text
          .setPlaceholder('相关链接\n参考资料')
          .setValue(this.plugin.settings.excludedHeadings.join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.excludedHeadings = value
              .split('\n')
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            await this.plugin.saveSettings();
            this.plugin.refreshMindmapViews();
          });
        text.inputEl.rows = 6;
        text.inputEl.style.width = '100%';
      });
  }
}
