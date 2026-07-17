/**
 * Full Content MindMap Plugin
 *
 * 入口：注册视图、命令、监听文件变化
 */

import { Plugin, WorkspaceLeaf } from 'obsidian';
import { MindMapView, VIEW_TYPE } from './view';
import { MindMapSettings, DEFAULT_SETTINGS, MindMapSettingTab } from './settings';

export default class FullContentMindMapPlugin extends Plugin {
  settings: MindMapSettings = DEFAULT_SETTINGS;

  async onload() {
    console.log('Loading Full Content MindMap plugin');

    await this.loadSettings();
    this.addSettingTab(new MindMapSettingTab(this.app, this));

    // 注册视图
    this.registerView(VIEW_TYPE, (leaf) => new MindMapView(leaf, this));

    // 命令：在 markdown ⇄ 思维导图之间来回切换（同一个命令双向）
    this.addCommand({
      id: 'toggle-mindmap-view',
      name: '切换思维导图 / 文档',
      callback: () => {
        this.toggleMindmapInCurrentLeaf();
      },
    });

    // 命令：适应窗口（缩放思维导图到适合视口大小）
    this.addCommand({
      id: 'fit-mindmap',
      name: '思维导图：适应窗口',
      checkCallback: (checking: boolean) => {
        const view = this.getActiveMindMapView();
        if (view) {
          if (!checking) view.fit();
          return true;
        }
        return false;
      },
    });

    // 监听活动文件切换
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        const view = this.getActiveMindMapView();
        if (view) {
          view.renderCurrentFile();
        }
      })
    );

    // 监听文件内容变化
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        const view = this.getActiveMindMapView();
        if (view && file === this.app.workspace.getActiveFile()) {
          // 防抖延迟刷新
          setTimeout(() => view.renderCurrentFile(), 500);
        }
      })
    );
  }

  async onunload() {
    console.log('Unloading Full Content MindMap plugin');
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.refreshMindmapViews();
  }

  /** 设置变更后，刷新所有打开的思维导图视图（重新解析，用于排除标题等） */
  refreshMindmapViews() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      (leaf.view as MindMapView).renderCurrentFile();
    });
  }

  /** 展开层级变更后，应用到所有打开的思维导图视图（无需重新解析） */
  applyExpandLevelToViews(level: number) {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      (leaf.view as MindMapView).setExpandLevel(level);
    });
  }

  /**
   * 在当前 leaf 上双向切换：
   * - markdown 视图 → 思维导图
   * - 思维导图 → markdown（切回原文件的编辑模式）
   */
  async toggleMindmapInCurrentLeaf() {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (!activeLeaf) return;

    const currentType = activeLeaf.view.getViewType();

    // 已在思维导图 → 切回 markdown
    if (currentType === VIEW_TYPE) {
      const mindmapView = activeLeaf.view as MindMapView;
      const path = mindmapView.getFilePath();
      if (!path) return;
      await activeLeaf.setViewState({
        type: 'markdown',
        active: true,
        state: { file: path, mode: 'source' },
      });
      return;
    }

    // 在 markdown（或其它）视图 → 切到思维导图
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'md') return;

    await activeLeaf.setViewState({
      type: VIEW_TYPE,
      active: true,
      state: { file: file.path },
    });
  }

  /**
   * 激活思维导图视图（若不存在则创建）
   * 保留此方法以备未来扩展使用
   */
  async activateView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE);

    if (leaves.length > 0) {
      // 已存在，激活
      leaf = leaves[0];
    } else {
      // 创建新视图在右侧
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE, active: true });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  /**
   * 获取当前激活的 MindMapView
   */
  private getActiveMindMapView(): MindMapView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length > 0) {
      return leaves[0].view as MindMapView;
    }
    return null;
  }
}
