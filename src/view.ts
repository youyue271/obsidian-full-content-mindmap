/**
 * Full Content MindMap — ItemView
 *
 * 负责：
 * 1. 维护 SVG 容器和 Markmap 实例
 * 2. 接收文件内容 → 解析 → 渲染
 * 3. 处理节点点击：展开/折叠 + 跳转到源文件
 * 4. 主题跟随 Obsidian 明暗色
 */

import { ItemView, WorkspaceLeaf, TFile, MarkdownView } from 'obsidian';
import type FullContentMindMapPlugin from './main';
import { parseMarkdown } from './parser/blockParser';
import { buildTree } from './parser/treeBuilder';
import { createMarkmap, toggleNodeExpansion } from './render/markmapWrapper';
import type { MindMapNode } from './types';

export const VIEW_TYPE = 'full-content-mindmap';

export class MindMapView extends ItemView {
  private plugin: FullContentMindMapPlugin;
  private mm: ReturnType<typeof createMarkmap> | null = null;
  private currentRoot: MindMapNode | null = null;
  private currentFile: TFile | null = null;
  private svgEl: SVGSVGElement | null = null;
  private filePath: string | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private fitTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: FullContentMindMapPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  /**
   * 接收 setViewState 传入的 state（含目标文件路径）
   */
  async setState(state: any, result: any): Promise<void> {
    if (state?.file) {
      this.filePath = state.file;
    }
    await super.setState(state, result);
    // state 到达后渲染对应文件
    await this.renderCurrentFile();
  }

  /**
   * 持久化 state（切换/重载时保留文件路径）
   */
  getState(): any {
    return { file: this.filePath };
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return '思维导图';
  }

  getIcon(): string {
    return 'git-fork';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('full-mindmap-container');

    // SVG 容器（先放，撑满剩余空间）
    const svgWrap = container.createDiv({ cls: 'mm-svg-wrap' });
    this.svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    this.svgEl.style.width = '100%';
    this.svgEl.style.height = '100%';
    svgWrap.appendChild(this.svgEl);

    this.mm = createMarkmap(this.svgEl);

    // 容器尺寸变化时（打开、拖拽面板、窗口 resize）防抖重新适应窗口
    this.resizeObserver = new ResizeObserver(() => this.scheduleFit());
    this.resizeObserver.observe(svgWrap);

    // 工具栏（底部）
    const toolbar = container.createDiv({ cls: 'mm-toolbar' });
    toolbar.createEl('button', { text: '返回编辑', cls: 'mm-btn' })
      .addEventListener('click', () => this.switchBackToMarkdown());
    toolbar.createEl('button', { text: '适应窗口', cls: 'mm-btn' })
      .addEventListener('click', () => this.mm?.fit());
    toolbar.createEl('button', { text: '刷新', cls: 'mm-btn' })
      .addEventListener('click', () => this.renderCurrentFile());

    // 事件代理：点击 expand/collapse 按钮 → 切换展开态
    svgWrap.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // 只有点在展开/折叠按钮上才切换
      const btn = target.closest('.expand-btn, .collapse-btn') as HTMLElement | null;
      if (btn && this.currentRoot) {
        const nodeEl = btn.closest('[data-node-id]') as HTMLElement | null;
        const nodeId = nodeEl?.dataset.nodeId;
        if (nodeId) {
          toggleNodeExpansion(this.currentRoot, nodeId);
          this.mm?.setData(this.currentRoot);
          // 重新布局后适应窗口
          this.scheduleFit();
        }
        e.stopPropagation();
        return;
      }

      // 点击节点跳转到源文件（data-jump-line 后续版本挂载）
      const jumpEl = target.closest('[data-jump-line]') as HTMLElement | null;
      if (jumpEl) {
        const line = parseInt(jumpEl.dataset.jumpLine || '0', 10);
        this.jumpToLine(line);
      }
    });

    await this.renderCurrentFile();
  }

  async onClose(): Promise<void> {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.fitTimer !== null) {
      window.clearTimeout(this.fitTimer);
      this.fitTimer = null;
    }
    this.mm?.destroy();
    this.mm = null;
  }

  /**
   * 防抖调用 fit：只在容器有实际尺寸时执行，避免视图切换瞬间高度为 0 导致内容缩到顶部
   */
  private scheduleFit(): void {
    if (this.fitTimer !== null) window.clearTimeout(this.fitTimer);
    this.fitTimer = window.setTimeout(() => {
      this.fitTimer = null;
      const wrap = this.svgEl?.parentElement;
      if (!wrap || wrap.clientHeight === 0 || wrap.clientWidth === 0) return;
      this.mm?.fit();
    }, 80);
  }

  /**
   * 渲染当前活动文件
   */
  async renderCurrentFile(): Promise<void> {
    // 优先用 state 里存的文件路径；回退到活动文件
    let file: TFile | null = null;
    if (this.filePath) {
      const f = this.app.vault.getAbstractFileByPath(this.filePath);
      if (f instanceof TFile) file = f;
    }
    if (!file) {
      const active = this.app.workspace.getActiveFile();
      if (active && active.extension === 'md') file = active;
    }
    if (!file || file.extension !== 'md') return;
    await this.renderFile(file);
  }

  /**
   * 渲染指定文件
   */
  async renderFile(file: TFile): Promise<void> {
    this.currentFile = file;
    this.filePath = file.path;

    const content = await this.app.vault.cachedRead(file);
    const blocks = parseMarkdown(content);
    const root = buildTree(blocks, file.basename);
    this.currentRoot = root;

    if (this.mm) {
      this.mm.setData(root);
      // 等 DOM/容器尺寸稳定后再 fit（ResizeObserver 也会兜底）
      this.scheduleFit();
    }
  }

  /**
   * 切换回 markdown 编辑模式
   */
  private async switchBackToMarkdown(): Promise<void> {
    if (!this.currentFile) return;

    await this.leaf.setViewState({
      type: 'markdown',
      state: { file: this.currentFile.path, mode: 'source' }
    });
  }

  /**
   * 跳转到当前文件指定行（切回 markdown 视图并定位）
   */
  private async jumpToLine(line: number): Promise<void> {
    if (!this.currentFile) return;

    // 切回 markdown 编辑模式
    await this.leaf.setViewState({
      type: 'markdown',
      state: { file: this.currentFile.path, mode: 'source' }
    });

    // 等待视图切换完成后定位
    setTimeout(() => {
      const view = this.leaf.view;
      if (view instanceof MarkdownView && view.editor) {
        view.editor.setCursor({ line, ch: 0 });
        view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
      }
    }, 100);
  }
}
