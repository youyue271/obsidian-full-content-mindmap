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

/** 新建节点的占位文字（空 markdown 无法正确解析，用占位符保证解析出节点；编辑时全选便于替换） */
const PLACEHOLDER = '新节点';

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
  /** 当前选中节点 id（键盘操作的作用对象） */
  private selectedNodeId: string | null = null;
  /** 写入后期望重新聚焦的源文件行号（重渲后据此恢复选中） */
  private pendingFocusLine: number | null = null;

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
    // 把设置里的样式项写成 CSS 变量（宽度、字号、行高等）
    this.applyStyleVars(container);

    const svgWrap = container.createDiv({ cls: 'mm-svg-wrap' });
    this.svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    this.svgEl.style.width = '100%';
    this.svgEl.style.height = '100%';
    svgWrap.appendChild(this.svgEl);

    const s = this.plugin.settings;
    this.mm = createMarkmap(this.svgEl, s.defaultExpandLevel, {
      maxWidth: s.nodeMaxWidth,
      spacingVertical: s.spacingVertical,
      spacingHorizontal: s.spacingHorizontal,
    });

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

    // 键盘快捷键（新建/删除/导航/编辑），容器需可聚焦
    svgWrap.tabIndex = 0;
    svgWrap.addEventListener('keydown', (e: KeyboardEvent) => this.handleKeyDown(e));

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
      return;
    }

    // 4) 点击节点内容区 → 选中该节点（键盘操作的作用对象）
    const nodeEl = target.closest('[data-node-id]') as HTMLElement | null;
    if (nodeEl?.dataset.nodeId) {
      this.selectNode(nodeEl.dataset.nodeId);
    }
  }

  /** 选中节点：更新 selectedNodeId 并刷新高亮 */
  private selectNode(nodeId: string | null): void {
    this.selectedNodeId = nodeId;
    this.refreshSelectionHighlight();
  }

  /** 根据 selectedNodeId 给对应 foreignObject 加/去 mm-selected 高亮 */
  private refreshSelectionHighlight(): void {
    if (!this.svgEl) return;
    this.svgEl.querySelectorAll('.mm-selected').forEach((el) => el.classList.remove('mm-selected'));
    if (!this.selectedNodeId) return;
    const el = this.svgEl.querySelector(`[data-node-id="${this.selectedNodeId}"]`);
    // 高亮加在节点根 div（.markmap-foreign 的子 div）上
    el?.closest('.markmap-foreign')?.classList.add('mm-selected');
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
    this.openEditor(node);
  }

  /**
   * 原地编辑：在节点 DOM 元素的位置直接叠一个 textarea，无弹框、无按钮。
   * Enter 保存（Shift+Enter 换行），Esc 取消，失焦保存。
   */
  private openEditor(node: MindMapNode): void {
    this.closeEditor();
    if (!this.svgEl) return;

    // 找到节点在 SVG 里的 DOM 元素，定位编辑框覆盖其上
    const nodeEl = this.svgEl.querySelector(`[data-node-id="${node.id}"]`) as HTMLElement | null;
    const foreign = nodeEl?.closest('.markmap-foreign') as HTMLElement | null;
    const anchor = foreign ?? nodeEl;
    const containerRect = this.containerEl.getBoundingClientRect();
    const rect = anchor?.getBoundingClientRect();

    const textarea = this.containerEl.createEl('textarea', { cls: 'mm-inline-edit' });
    textarea.value = node.rawForEdit ?? '';

    const left = rect ? rect.left - containerRect.left : 8;
    const top = rect ? rect.top - containerRect.top : 8;
    const width = Math.max(rect?.width ?? 0, 160);
    textarea.style.left = `${left}px`;
    textarea.style.top = `${top}px`;
    textarea.style.width = `${width}px`;

    this.editOverlay = textarea;

    let done = false; // 防止 blur 与 Enter/Esc 重复触发
    const save = () => {
      if (done) return;
      done = true;
      this.saveNodeEdit(node, textarea.value);
    };
    const cancel = () => {
      if (done) return;
      done = true;
      this.closeEditor();
    };
    // 高度自适应内容
    const autoGrow = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    textarea.addEventListener('input', autoGrow);
    textarea.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        cancel();
      } else if (ev.key === 'Enter' && !ev.shiftKey) {
        // Enter 保存；Shift+Enter 换行
        ev.preventDefault();
        save();
      }
      ev.stopPropagation(); // 不让 keydown 冒泡到 svgWrap 的快捷键处理
    });
    // 失焦即保存（点击别处）
    textarea.addEventListener('blur', () => save());

    autoGrow();
    textarea.focus();
    // 占位文字全选（首次输入即替换）；已有内容则光标置末尾
    if ((node.rawForEdit ?? '').includes(PLACEHOLDER)) {
      textarea.select();
    } else {
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
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

  /** 查找节点的父节点 */
  private findParent(root: MindMapNode, target: MindMapNode): MindMapNode | null {
    for (const child of root.children) {
      if (child === target) return root;
      const found = this.findParent(child, target);
      if (found) return found;
    }
    return null;
  }

  // ─────────────────────────────────────────────
  // 键盘操作
  // ─────────────────────────────────────────────

  private handleKeyDown(e: KeyboardEvent): void {
    // 编辑框打开时交给编辑框自己处理
    if (this.editOverlay) return;
    if (!this.currentRoot) return;

    const sel = this.selectedNodeId ? this.findNodeById(this.currentRoot, this.selectedNodeId) : null;

    switch (e.key) {
      case 'Enter':
        if (sel) { e.preventDefault(); this.insertSibling(sel); }
        break;
      case 'Tab':
        if (sel) { e.preventDefault(); this.insertChild(sel); }
        break;
      case 'Delete':
      case 'Backspace':
        if (sel) { e.preventDefault(); this.deleteNode(sel); }
        break;
      case 'F2':
        if (sel && sel.rawForEdit !== undefined) {
          e.preventDefault();
          this.openEditorForSelected(sel);
        }
        break;
      case 'ArrowUp':
        e.preventDefault(); this.navigateSibling(sel, -1);
        break;
      case 'ArrowDown':
        e.preventDefault(); this.navigateSibling(sel, 1);
        break;
      case 'ArrowLeft':
        e.preventDefault(); this.navigateToParent(sel);
        break;
      case 'ArrowRight':
        e.preventDefault(); this.navigateToChild(sel);
        break;
      case 'Escape':
        this.selectNode(null);
        break;
    }
  }

  // ── 导航 ──

  private navigateSibling(sel: MindMapNode | null, dir: 1 | -1): void {
    if (!this.currentRoot) return;
    if (!sel) { // 未选中：选第一个顶层子节点
      const first = this.currentRoot.children[0];
      if (first) this.selectNode(first.id);
      return;
    }
    const parent = this.findParent(this.currentRoot, sel);
    if (!parent) return;
    const idx = parent.children.indexOf(sel);
    const next = parent.children[idx + dir];
    if (next) this.selectNode(next.id);
  }

  private navigateToParent(sel: MindMapNode | null): void {
    if (!this.currentRoot || !sel) return;
    const parent = this.findParent(this.currentRoot, sel);
    if (parent && parent !== this.currentRoot) this.selectNode(parent.id);
  }

  private navigateToChild(sel: MindMapNode | null): void {
    if (!sel) return;
    const first = sel.children[0];
    if (first) this.selectNode(first.id);
  }

  private openEditorForSelected(node: MindMapNode): void {
    this.openEditor(node);
  }

  // ── 新建 / 删除 ──

  /**
   * 计算节点"所在区域"的结束行（含子内容）：
   * - 标题：下一个同级或更高级标题的 startLine - 1，否则文件末尾
   * - 其它：自身 endLine
   */
  private sectionEndLine(node: MindMapNode, totalLines: number): number {
    // 非标题：取节点及其所有后代的最大 endLine（含嵌套子列表 / 冒号子项），
    // 否则会把兄弟节点插到当前节点和它的子节点之间。
    if (node.type !== 'heading' || !this.currentRoot) return this.deepEndLine(node);
    const level = node.headingLevel ?? 1;

    // 收集全树中所有标题，按 startLine 排序，找 node 之后第一个 level<= 的
    const headings: MindMapNode[] = [];
    const collect = (n: MindMapNode) => {
      if (n.type === 'heading') headings.push(n);
      n.children.forEach(collect);
    };
    collect(this.currentRoot);
    headings.sort((a, b) => a.startLine - b.startLine);

    const after = headings.filter((h) => h.startLine > node.startLine);
    const nextSameOrHigher = after.find((h) => (h.headingLevel ?? 1) <= level);
    return nextSameOrHigher ? nextSameOrHigher.startLine - 1 : totalLines - 1;
  }

  /** 递归取节点及其所有后代的最大 endLine */
  private deepEndLine(node: MindMapNode): number {
    let max = node.endLine;
    for (const child of node.children) {
      max = Math.max(max, this.deepEndLine(child));
    }
    return max;
  }

  /** 从列表项原文提取行首缩进（用于插入同级/子列表项时保持缩进） */
  private listIndent(node: MindMapNode): string {
    const m = (node.rawForEdit ?? '').match(/^([ \t]*)(?:[-*+]|\d+[.)])\s/);
    return m ? m[1] : '';
  }

  /** 新建兄弟节点：在当前节点所在区域之后插入同类空节点 */
  private async insertSibling(node: MindMapNode): Promise<void> {
    if (!this.currentFile || node.type === 'root') return;
    const content = await this.app.vault.read(this.currentFile);
    const lines = content.split('\n');
    const at = this.sectionEndLine(node, lines.length) + 1;

    let text: string;
    switch (node.type) {
      case 'heading': {
        const hashes = '#'.repeat(node.headingLevel ?? 1);
        text = `${hashes} ${PLACEHOLDER}`;
        break;
      }
      case 'list':
        text = `${this.listIndent(node)}- ${PLACEHOLDER}`;
        break;
      default:
        text = PLACEHOLDER; // 段落/引用/embed → 占位段落（前后空行分隔）
    }

    // 兄弟之间用空行分隔（段落类），标题/列表不需要额外空行
    const insertLines = node.type === 'heading' || node.type === 'list'
      ? [text]
      : ['', text];
    lines.splice(at, 0, ...insertLines);
    // 聚焦到刚插入的那一行（insertLines 里 text 所在行）
    this.pendingFocusLine = at + (insertLines.length - 1);
    await this.writeAndReopen(lines.join('\n'));
  }

  /** 新建子节点：在当前节点自身末行之后插入下级空节点 */
  private async insertChild(node: MindMapNode): Promise<void> {
    if (!this.currentFile || node.type === 'embed') return;
    const content = await this.app.vault.read(this.currentFile);
    const lines = content.split('\n');
    const at = node.endLine + 1;

    let text: string;
    let isListLike = false;
    switch (node.type) {
      case 'heading': {
        const childLevel = Math.min((node.headingLevel ?? 1) + 1, 6);
        text = `${'#'.repeat(childLevel)} ${PLACEHOLDER}`;
        break;
      }
      case 'list':
        // 子列表项：父缩进 + 4 空格（与常见 md 一致，不用制表符，避免解析错乱）
        text = `${this.listIndent(node)}    - ${PLACEHOLDER}`;
        isListLike = true;
        break;
      case 'paragraph':
        // 冒号段落 → 子项用列表；普通段落 → 子段落
        if (/[：:]\s*$/.test(node.rawForEdit ?? '')) {
          text = `- ${PLACEHOLDER}`;
          isListLike = true;
        } else {
          text = PLACEHOLDER;
        }
        break;
      default:
        text = PLACEHOLDER;
    }

    const insertLines = node.type === 'heading' || node.type === 'list' || isListLike
      ? [text]
      : ['', text];
    lines.splice(at, 0, ...insertLines);
    this.pendingFocusLine = at + (insertLines.length - 1);
    await this.writeAndReopen(lines.join('\n'));
  }

  /** 删除节点自身行（不含子树；标题的子内容会在重渲后上浮） */
  private async deleteNode(node: MindMapNode): Promise<void> {
    if (!this.currentFile || node.type === 'root') return;
    const content = await this.app.vault.read(this.currentFile);
    const lines = content.split('\n');
    lines.splice(node.startLine, node.endLine - node.startLine + 1);
    this.selectedNodeId = null;
    this.pendingFocusLine = null;
    await this.writeAndReopen(lines.join('\n'));
  }

  /** 写回文件并重渲，重渲后若有 pendingFocusLine 则选中并打开编辑框 */
  private async writeAndReopen(newContent: string): Promise<void> {
    if (!this.currentFile) return;
    await this.app.vault.modify(this.currentFile, newContent);
    await this.renderCurrentFile();

    if (this.pendingFocusLine !== null && this.currentRoot) {
      const target = this.pendingFocusLine;
      this.pendingFocusLine = null;
      const found = this.findNodeByStartLine(this.currentRoot, target);
      if (found) {
        this.selectNode(found.id);
        if (found.rawForEdit !== undefined) this.openEditorForSelected(found);
      }
    }
  }

  /** 按 startLine 精确匹配节点 */
  private findNodeByStartLine(root: MindMapNode, line: number): MindMapNode | null {
    if (root.type !== 'root' && root.startLine === line) return root;
    for (const child of root.children) {
      const found = this.findNodeByStartLine(child, line);
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

  /** 把设置里的样式项写成容器上的 CSS 变量，供 styles.css 读取 */
  private applyStyleVars(container: HTMLElement): void {
    const s = this.plugin.settings;
    container.style.setProperty('--mm-node-width', `${s.nodeMaxWidth}px`);
    container.style.setProperty('--mm-font-size', `${s.fontSize}px`);
    container.style.setProperty('--mm-line-height', String(s.lineHeight));
  }

  async renderFile(file: TFile): Promise<void> {
    this.currentFile = file;
    this.filePath = file.path;
    this.lastRenderedPath = file.path;
    // 每次渲染前重新应用样式变量与 markmap 布局参数，使设置变更即时生效
    const container = this.containerEl.children[1] as HTMLElement;
    this.applyStyleVars(container);
    const s = this.plugin.settings;
    this.mm?.setSpacing(s.nodeMaxWidth, s.spacingVertical, s.spacingHorizontal);

    const content = await this.app.vault.cachedRead(file);
    const blocks = parseMarkdown(content);
    const root = buildTree(blocks, file.basename, this.plugin.settings.excludedHeadings, this.embedsExpanded);

    // 用 Obsidian 渲染每个节点的 markdown 原文 → summaryHtml / fullHtml
    await this.renderNodeHtml(root, file.path);
    this.currentRoot = root;

    if (this.mm) {
      this.mm.setData(root);
      this.scheduleFit();
      // 重渲后 DOM 重建，若之前有选中节点则重新高亮（延迟到 DOM 稳定）
      setTimeout(() => this.refreshSelectionHighlight(), 100);
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
