/**
 * Full Content MindMap — ItemView
 *
 * 负责：
 * 1. 维护 SVG 容器和 Markmap 实例
 * 2. 接收文件内容 → 解析 → 用 Obsidian 的 MarkdownRenderer 渲染每个节点 → 渲染
 * 3. 处理节点点击：展开/折叠 + 双链/外链跳转
 * 4. 自适应窗口（ResizeObserver）
 */

import { ItemView, WorkspaceLeaf, TFile, MarkdownView, MarkdownRenderer, Component } from 'obsidian';
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
  private levelSel: HTMLSelectElement | null = null;
  /** 承载本轮 markdown 渲染产生的子组件，重渲前整体卸载以避免泄漏 */
  private renderScope: Component | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: FullContentMindMapPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  /** 供命令读取当前文件路径 */
  getFilePath(): string | null {
    return this.filePath;
  }

  /** 设置展开层级并同步工具栏选择器（设置面板变更时调用） */
  setExpandLevel(level: number): void {
    if (this.levelSel) this.levelSel.value = String(level);
    this.mm?.expandTo(level);
    setTimeout(() => this.mm?.fit(), 80);
  }

  async setState(state: any, result: any): Promise<void> {
    if (state?.file) this.filePath = state.file;
    await super.setState(state, result);
    await this.renderCurrentFile();
  }

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

    const svgWrap = container.createDiv({ cls: 'mm-svg-wrap' });
    this.svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    this.svgEl.style.width = '100%';
    this.svgEl.style.height = '100%';
    svgWrap.appendChild(this.svgEl);

    this.mm = createMarkmap(this.svgEl, this.plugin.settings.defaultExpandLevel);

    // 容器尺寸变化时（打开、拖拽面板、窗口 resize）防抖重新适应窗口
    this.resizeObserver = new ResizeObserver(() => this.scheduleFit());
    this.resizeObserver.observe(svgWrap);

    // 工具栏（底部）
    const toolbar = container.createDiv({ cls: 'mm-toolbar' });

    // 展开层级选择器
    toolbar.createEl('span', { text: '展开层级：', cls: 'mm-label' });
    const levelSel = toolbar.createEl('select', { cls: 'mm-select' });
    levelSel.createEl('option', { value: '-1', text: '全部' });
    for (let i = 1; i <= 5; i++) {
      levelSel.createEl('option', { value: String(i), text: `第 ${i} 层` });
    }
    levelSel.value = String(this.plugin.settings.defaultExpandLevel);
    levelSel.addEventListener('change', () => {
      const lv = parseInt(levelSel.value, 10);
      this.mm?.expandTo(lv);
      setTimeout(() => this.mm?.fit(), 80);
    });
    this.levelSel = levelSel;

    toolbar.createEl('button', { text: '适应窗口', cls: 'mm-btn' })
      .addEventListener('click', () => this.mm?.fit());
    toolbar.createEl('button', { text: '刷新', cls: 'mm-btn' })
      .addEventListener('click', () => this.renderCurrentFile());

    svgWrap.addEventListener('click', (e: MouseEvent) => this.handleSvgClick(e));

    await this.renderCurrentFile();
  }

  async onClose(): Promise<void> {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.fitTimer !== null) {
      window.clearTimeout(this.fitTimer);
      this.fitTimer = null;
    }
    if (this.renderScope) {
      this.removeChild(this.renderScope);
      this.renderScope = null;
    }
    this.mm?.destroy();
    this.mm = null;
  }

  /** 委托处理 SVG 内的点击：展开/折叠、双链、外链 */
  private handleSvgClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;

    // 1) 展开/折叠按钮
    const btn = target.closest('.expand-btn, .collapse-btn') as HTMLElement | null;
    if (btn && this.currentRoot) {
      const nodeEl = btn.closest('[data-node-id]') as HTMLElement | null;
      const nodeId = nodeEl?.dataset.nodeId;
      if (nodeId) {
        toggleNodeExpansion(this.currentRoot, nodeId);
        this.mm?.setData(this.currentRoot);
        this.scheduleFit();
      }
      e.stopPropagation();
      e.preventDefault();
      return;
    }

    // 2) 内部双链（Obsidian 渲染出的 a.internal-link）
    const internal = target.closest('a.internal-link') as HTMLAnchorElement | null;
    if (internal) {
      const linktext = internal.dataset.href || internal.getAttribute('href') || internal.textContent || '';
      if (linktext) {
        this.app.workspace.openLinkText(linktext, this.currentFile?.path || '', false);
      }
      e.stopPropagation();
      e.preventDefault();
      return;
    }

    // 3) 外部链接
    const ext = target.closest('a.external-link, a[href^="http"]') as HTMLAnchorElement | null;
    if (ext) {
      const href = ext.getAttribute('href');
      if (href) window.open(href, '_blank');
      e.stopPropagation();
      e.preventDefault();
    }
  }

  async renderCurrentFile(): Promise<void> {
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

  async renderFile(file: TFile): Promise<void> {
    this.currentFile = file;
    this.filePath = file.path;

    const content = await this.app.vault.cachedRead(file);
    const blocks = parseMarkdown(content);
    const root = buildTree(blocks, file.basename, this.plugin.settings.excludedHeadings);

    // 用 Obsidian 渲染每个节点的 markdown 原文 → summaryHtml / fullHtml
    await this.renderNodeHtml(root, file.path);
    this.currentRoot = root;

    if (this.mm) {
      this.mm.setData(root);
      this.scheduleFit();
    }
  }

  /**
   * 遍历节点树，用 Obsidian 的 MarkdownRenderer 把 markdown 原文渲染成 HTML，
   * 填入每个节点的 summaryHtml / fullHtml。整棵树并行渲染。
   */
  private async renderNodeHtml(root: MindMapNode, sourcePath: string): Promise<void> {
    // 每轮重建渲染作用域，卸载上一轮的子组件
    if (this.renderScope) this.removeChild(this.renderScope);
    this.renderScope = new Component();
    this.addChild(this.renderScope);
    const scope = this.renderScope;

    const tasks: Promise<void>[] = [];
    const walk = (node: MindMapNode) => {
      tasks.push(this.fillNode(node, sourcePath, scope));
      node.children.forEach(walk);
    };
    walk(root);
    await Promise.all(tasks);
  }

  /** 渲染单个节点，按 renderMode 填充 summaryHtml / fullHtml */
  private async fillNode(node: MindMapNode, sourcePath: string, scope: Component): Promise<void> {
    if (node.renderMode === 'static') {
      node.summaryHtml = node.staticHtml || '';
      node.fullHtml = node.staticHtml || '';
      return;
    }

    if (node.renderMode === 'inline') {
      const inner = await this.renderMd(node.markdown || '', sourcePath, scope);
      const html = this.wrapInline(node, inner);
      node.summaryHtml = html;
      node.fullHtml = html;
      return;
    }

    // collapsible
    node.summaryHtml = node.collapsedHtml || `<span data-node-id="${node.id}">…</span>`;
    const inner = node.expandedHtml ?? await this.renderMd(node.markdown || '', sourcePath, scope);
    node.fullHtml =
      `<div class="mm-expanded" data-node-id="${node.id}">${inner}` +
      `<button class="collapse-btn">折叠</button></div>`;
  }

  /** 调 Obsidian 渲染一段 markdown，返回 innerHTML 字符串 */
  private async renderMd(md: string, sourcePath: string, scope: Component): Promise<string> {
    const holder = createDiv();
    await MarkdownRenderer.render(this.app, md, holder, sourcePath, scope);
    return holder.innerHTML;
  }

  /** inline 节点按类型套壳（标题字号、引用样式等） */
  private wrapInline(node: MindMapNode, inner: string): string {
    if (node.type === 'heading') {
      const level = node.headingLevel || 1;
      const fontSize = Math.max(1.6 - level * 0.1, 1.0);
      return `<div class="mm-heading" style="font-size:${fontSize}em;font-weight:600;">${inner}</div>`;
    }
    const supplementClass = node.isSupplement ? ' mm-supplement' : '';
    return `<div class="mm-inline mm-${node.type}${supplementClass}">${inner}</div>`;
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
   * 跳转到当前文件指定行（切回 markdown 视图并定位）
   */
  private async jumpToLine(line: number): Promise<void> {
    if (!this.currentFile) return;
    await this.leaf.setViewState({
      type: 'markdown',
      state: { file: this.currentFile.path, mode: 'source' },
    });
    setTimeout(() => {
      const view = this.leaf.view;
      if (view instanceof MarkdownView && view.editor) {
        view.editor.setCursor({ line, ch: 0 });
        view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
      }
    }, 100);
  }
}
