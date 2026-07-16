/**
 * Full Content MindMap Plugin
 *
 * 入口：注册视图、命令、监听文件变化
 */

import { Plugin, WorkspaceLeaf } from 'obsidian';
import { MindMapView, VIEW_TYPE } from './view';

export default class FullContentMindMapPlugin extends Plugin {
  async onload() {
    console.log('Loading Full Content MindMap plugin');

    // 注册视图
    this.registerView(VIEW_TYPE, (leaf) => new MindMapView(leaf, this));

    // 命令：在当前标签页切换到思维导图视图
    this.addCommand({
      id: 'open-mindmap-view',
      name: '打开思维导图',
      callback: () => {
        this.toggleMindmapInCurrentLeaf();
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

  /**
   * 在当前 leaf 上切换到思维导图视图（原地替换 viewState）
   */
  async toggleMindmapInCurrentLeaf() {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (!activeLeaf) return;

    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'md') {
      return;
    }

    // 在当前 leaf 上设置为思维导图视图
    await activeLeaf.setViewState({
      type: VIEW_TYPE,
      active: true,
      state: { file: file.path }
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
