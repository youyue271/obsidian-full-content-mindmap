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
  private embedBtn: HTMLButtonElement | null = null;
  private embedsExpanded = false;
  /** 上一次实际渲染的文件路径，用于跳过 setState 的重复渲染 */
  private lastRenderedPath: string | null = null;
  private renderScope: Component | null = null;
  private editOverlay: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: FullContentMindMapPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.embedsExpanded = !plugin.settings.embedsAsLinks;
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

  /** 适应窗口：缩放思维导图到适合视口大小（供命令/快捷键调用） */
  fit(): void {
    this.mm?.fit();
  }

  /** 一键翻转所有 embed 节点的展开/收拢状态，无需重新解析文档 */
  private toggleAllEmbeds(): void {
    if (!this.currentRoot) return;
    this.embedsExpanded = !this.embedsExpanded;
    if (this.embedBtn) {
      this.embedBtn.textContent = this.embedsExpanded ? '收拢引用' : '展开引用';
    }
    // 遍历树，把所有 embed 节点，以及含嵌入的引用/callout 节点切换到新状态
    const walk = (node: MindMapNode) => {
      if (node.type === 'embed' || node.hasEmbed) node.expanded = this.embedsExpanded;
      node.children.forEach(walk);
    };
    walk(this.currentRoot);
    this.mm?.updateContent(this.currentRoot);
    this.scheduleFit();
  }

  async setState(state: any, result: any): Promise<void> {
    if (state?.file) this.filePath = state.file;
    await super.setState(state, result);
    // 跳过重渲：绑定文件没变（包括 Obsidian 传入空 state 的 focus 事件）
    if (this.filePath && this.filePath === this.lastRenderedPath) return;
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
    // 节点宽度：同时驱动 markmap 布局与 CSS max-width（通过 CSS 变量）
    const nodeWidth = this.plugin.settings.nodeMaxWidth;
    container.style.setProperty('--mm-node-width', `${nodeWidth}px`);

    const svgWrap = container.createDiv({ cls: 'mm-svg-wrap' });
    this.svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    this.svgEl.style.width = '100%';
    this.svgEl.style.height = '100%';
    svgWrap.appendChild(this.svgEl);

    this.mm = createMarkmap(this.svgEl, this.plugin.settings.defaultExpandLevel, nodeWidth);

    // 容器尺寸变化时（打开、拖拽面板、窗口 resize）防抖重新适应窗口
    this.resizeObserver = new ResizeObserver(() => this.scheduleFit());
    this.resizeObserver.observe(svgWrap);

    // 工具栏（底部）
    const toolbar = container.createDiv({ cls: 'mm-toolbar' });

    // 展开层级选择器
    toolbar.createEl('span', { text: '展开层级：', cls: 'mm-label' });
    const levelSel = toolbar.createEl('select', { cls: 'mm-select' });
    levelSel.createEl('option', { value: '-999', text: '全部' });
    for (let i = 1; i <= 5; i++) {
      levelSel.createEl('option', { value: String(i), text: `第 ${i} 层` });
    }
    levelSel.createEl('option', { value: '-1', text: '收拢最后1层' });
    levelSel.createEl('option', { value: '-2', text: '收拢最后2层' });
    levelSel.createEl('option', { value: '-3', text: '收拢最后3层' });
    levelSel.value = String(this.plugin.settings.defaultExpandLevel);
    levelSel.addEventListener('change', () => {
      const lv = parseInt(levelSel.value, 10);
      this.mm?.expandTo(lv);
      setTimeout(() => this.mm?.fit(), 80);
    });
    this.levelSel = levelSel;

    // 嵌入展开/收拢按钮
    const embedBtn = toolbar.createEl('button', { cls: 'mm-btn' });
    embedBtn.textContent = this.embedsExpanded ? '收拢引用' : '展开引用';
    embedBtn.addEventListener('click', () => this.toggleAllEmbeds());
    this.embedBtn = embedBtn;

    toolbar.createEl('button', { text: '适应窗口', cls: 'mm-btn' })
      .addEventListener('click', () => this.mm?.fit());
    toolbar.createEl('button', { text: '刷新', cls: 'mm-btn' })
      .addEventListener('click', () => this.renderCurrentFile());

    svgWrap.addEventListener('click', (e: MouseEvent) => this.handleSvgClick(e));

    // 双击节点 → 编辑源文件。capture 阶段拦截，先于 markmap 的 dblclick stopPropagation
    svgWrap.addEventListener('dblclick', (e: MouseEvent) => this.handleDblClick(e), true);

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
    this.closeEditor();
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
        this.mm?.updateContent(this.currentRoot);
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

  /** 双击节点 → 弹出编辑框修改源文件对应块 */
  private handleDblClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    // 双击链接/按钮不进入编辑
    if (target.closest('a, button')) return;

    const nodeEl = target.closest('[data-node-id]') as HTMLElement | null;
    const nodeId = nodeEl?.dataset.nodeId;
    if (!nodeId || !this.currentRoot) return;

    const node = this.findNodeById(this.currentRoot, nodeId);
    if (!node || node.rawForEdit === undefined) return; // 不可编辑的节点忽略

    e.stopPropagation();
    e.preventDefault();
    this.openEditor(node, e.clientX, e.clientY);
  }

  /** 打开浮动编辑框 */
  private openEditor(node: MindMapNode, clientX: number, clientY: number): void {
    this.closeEditor();

    const overlay = this.containerEl.createDiv({ cls: 'mm-edit-overlay' });
    const rect = this.containerEl.getBoundingClientRect();

    const textarea = overlay.createEl('textarea', { cls: 'mm-edit-textarea' });
    textarea.value = node.rawForEdit ?? '';

    const bar = overlay.createDiv({ cls: 'mm-edit-bar' });
    bar.createSpan({ cls: 'mm-edit-hint', text: 'Ctrl+Enter 保存 · Esc 取消' });
    const saveBtn = bar.createEl('button', { cls: 'mm-btn', text: '保存' });
    const cancelBtn = bar.createEl('button', { cls: 'mm-btn', text: '取消' });

    // 定位在点击处附近，钳制在容器内
    const w = 360, h = 180;
    let left = clientX - rect.left + 8;
    let top = clientY - rect.top + 8;
    left = Math.max(4, Math.min(left, rect.width - w - 4));
    top = Math.max(4, Math.min(top, rect.height - h - 4));
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;

    this.editOverlay = overlay;

    const save = () => this.saveNodeEdit(node, textarea.value);
    saveBtn.addEventListener('click', save);
    cancelBtn.addEventListener('click', () => this.closeEditor());
    textarea.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.closeEditor();
      } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        save();
      }
    });

    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  private closeEditor(): void {
    if (this.editOverlay) {
      this.editOverlay.remove();
      this.editOverlay = null;
    }
  }

  /** 保存编辑：把新内容写回源文件对应行范围，然后重渲 */
  private async saveNodeEdit(node: MindMapNode, newText: string): Promise<void> {
    this.closeEditor();
    if (!this.currentFile) return;

    const original = node.rawForEdit ?? '';
    if (newText === original) return; // 无改动

    await this.app.vault.process(this.currentFile, (content) => {
      const lines = content.split('\n');
      // startLine~endLine（含）替换为新内容的行
      const before = lines.slice(0, node.startLine);
      const after = lines.slice(node.endLine + 1);
      return [...before, ...newText.split('\n'), ...after].join('\n');
    });

    // 立即重渲（vault.on('modify') 也会触发，但有防抖延迟）
    await this.renderCurrentFile();
  }

  /** 按 id 在树中查找节点 */
  private findNodeById(root: MindMapNode, id: string): MindMapNode | null {
    if (root.id === id) return root;
    for (const child of root.children) {
      const found = this.findNodeById(child, id);
      if (found) return found;
    }
    return null;
  }

  async renderCurrentFile(): Promise<void> {
    if (!this.filePath) return;
    const f = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!(f instanceof TFile) || f.extension !== 'md') return;
    await this.renderFile(f);
  }

  async renderFile(file: TFile): Promise<void> {
    this.currentFile = file;
    this.filePath = file.path;
    this.lastRenderedPath = file.path;

    // 每次渲染前应用节点宽度设置（CSS 变量 + markmap maxWidth），使设置变更即时生效
    const nodeWidth = this.plugin.settings.nodeMaxWidth;
    (this.containerEl.children[1] as HTMLElement)?.style.setProperty('--mm-node-width', `${nodeWidth}px`);
    this.mm?.setMaxWidth(nodeWidth);

    const content = await this.app.vault.cachedRead(file);
    const blocks = parseMarkdown(content);
    const root = buildTree(blocks, file.basename, this.plugin.settings.excludedHeadings, this.embedsExpanded);

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
      const md = node.markdown || '';
      // blockquote / callout 内若含 ![[X]] 嵌入：生成"链接态 + 嵌入态"两个版本，
      // 跟随全局"展开引用/收拢引用"切换（toggleAllEmbeds 翻转 expanded）
      const hasEmbed = /!\[\[[^\]]+\]\]/.test(md);
      if (hasEmbed && (node.type === 'blockquote' || node.type === 'callout')) {
        const linkInner = await this.renderMd(md.replace(/!\[\[/g, '[['), sourcePath, scope);
        const embedInner = await this.renderMd(md, sourcePath, scope);
        const cls = `mm-inline mm-${node.type}${node.isSupplement ? ' mm-supplement' : ''}`;
        node.summaryHtml =
          `<div class="mm-card ${cls}" data-node-id="${node.id}">` +
          `<button class="expand-btn" aria-label="展开">+</button>` +
          `<div class="mm-card-body">${linkInner}</div></div>`;
        node.fullHtml =
          `<div class="mm-card ${cls}" data-node-id="${node.id}">` +
          `<button class="collapse-btn" aria-label="收起">−</button>` +
          `<div class="mm-card-body">${embedInner}</div></div>`;
        node.hasEmbed = true;
        node.expanded = this.embedsExpanded;
        return;
      }
      const inner = await this.renderMd(md, sourcePath, scope);
      const html = this.wrapInline(node, inner);
      node.summaryHtml = html;
      node.fullHtml = html;
      return;
    }

    // collapsible
    if (node.collapsedMarkdown) {
      const collapsedInner = await this.renderMd(node.collapsedMarkdown, sourcePath, scope);
      node.summaryHtml =
        `<div class="mm-card mm-embed-link" data-node-id="${node.id}">` +
        `<button class="expand-btn" aria-label="展开">+</button>` +
        `<div class="mm-card-body">${collapsedInner}</div></div>`;
    } else {
      node.summaryHtml = node.collapsedHtml || `<span data-node-id="${node.id}">…</span>`;
    }
    const inner = node.expandedHtml ?? await this.renderMd(node.markdown || '', sourcePath, scope);
    node.fullHtml =
      `<div class="mm-card mm-expanded" data-node-id="${node.id}">` +
      `<button class="collapse-btn" aria-label="收起">−</button>` +
      `<div class="mm-card-body">${inner}</div></div>`;
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
      return `<div class="mm-heading" data-node-id="${node.id}" style="font-size:${fontSize}em;font-weight:600;">${inner}</div>`;
    }
    const supplementClass = node.isSupplement ? ' mm-supplement' : '';
    return `<div class="mm-inline mm-${node.type}${supplementClass}" data-node-id="${node.id}">${inner}</div>`;
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
