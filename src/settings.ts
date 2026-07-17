/**
 * 插件设置
 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import type FullContentMindMapPlugin from './main';

export interface MindMapSettings {
  /** 生成思维导图时要排除的标题（按标题文本匹配，大小写不敏感，双链取显示文本） */
  excludedHeadings: string[];
  /** 默认展开层级：-1 = 全部展开，1–5 = 展开到该层 */
  defaultExpandLevel: number;
  /** true（默认）：![[X]] 默认按 [[X]] 双链渲染，可点击展开为完整嵌入；false：直接渲染为嵌入 */
  embedsAsLinks: boolean;
}

export const DEFAULT_SETTINGS: MindMapSettings = {
  excludedHeadings: ['相关链接'],
  defaultExpandLevel: -999, // -999 = 全部展开
  embedsAsLinks: true,
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
      .setName('默认展开层级')
      .setDesc('打开思维导图时默认的展开/收拢模式。「收拢最后 N 层」隐藏最深的 N 层叶子节点。')
      .addDropdown((dd) => {
        dd.addOption('-999', '全部展开');
        for (let i = 1; i <= 5; i++) dd.addOption(String(i), `第 ${i} 层`);
        dd.addOption('-1', '收拢最后1层');
        dd.addOption('-2', '收拢最后2层');
        dd.addOption('-3', '收拢最后3层');
        dd.setValue(String(this.plugin.settings.defaultExpandLevel));
        dd.onChange(async (value) => {
          const level = parseInt(value, 10);
          this.plugin.settings.defaultExpandLevel = level;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.applyExpandLevelToViews(level);
        });
      });

    new Setting(containerEl)
      .setName('嵌入链接默认收起')
      .setDesc(
        '开启时，![[笔记]] 默认显示为 [[双链]] 形式；底部工具栏可一键全部展开/收拢。' +
        '关闭则直接渲染嵌入内容。'
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.embedsAsLinks)
          .onChange(async (value) => {
            this.plugin.settings.embedsAsLinks = value;
            await this.plugin.saveSettings();
          });
      });

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
          });
        text.inputEl.rows = 6;
        text.inputEl.style.width = '100%';
      });
  }
}
