/**
 * 树构建器：扁平块数组 → 标题树（块内容挂到所属标题下）
 *
 * 规则：
 * 1. 标题按 level 构建主干树（H1 > H2 > H3 …）
 * 2. 标题与标题之间的所有块内容 → 挂到前一个标题作为子节点
 * 3. 文档开头无标题的内容 → 挂到虚拟根节点
 *
 * 本层只决定"每个节点怎么渲染"（renderMode + 原文 / 静态 HTML），
 * 真正的 markdown→HTML 渲染在 view.ts 用 Obsidian 的 MarkdownRenderer 完成。
 */

import type { ParsedBlock } from './blockParser';
import type { MindMapNode } from '../types';

let nodeIdCounter = 0;

export function buildTree(
  blocks: ParsedBlock[],
  fileName: string,
  excludedHeadings: string[] = [],
): MindMapNode {
  nodeIdCounter = 0;

  const root: MindMapNode = {
    id: genId(),
    type: 'root',
    renderMode: 'static',
    staticHtml: `<strong>${escapeHtml(fileName)}</strong>`,
    summaryHtml: '',
    fullHtml: '',
    expanded: false,
    startLine: 0,
    children: [],
  };

  const excludeSet = excludedHeadings
    .map((h) => normalizeHeading(h))
    .filter((h) => h.length > 0);

  const stack: MindMapNode[] = [root];
  // 当前正在被排除的标题层级；null 表示未处于排除态
  let skipLevel: number | null = null;

  for (const block of blocks) {
    if (block.type === 'heading') {
      const level = block.headingLevel!;

      // 若处于排除态：遇到同级或更高级标题才结束排除，否则继续跳过
      if (skipLevel !== null) {
        if (level > skipLevel) continue;
        skipLevel = null;
      }

      // 命中排除名单：跳过该标题及其下所有内容，直到出现同级/更高级标题
      if (excludeSet.includes(normalizeHeading(block.raw))) {
        skipLevel = level;
        continue;
      }

      while (stack.length > 1) {
        const top = stack[stack.length - 1];
        if (top.type === 'heading' && top.headingLevel! >= level) stack.pop();
        else break;
      }
      const headingNode = configureNode({
        id: genId(),
        type: 'heading',
        headingLevel: level,
        renderMode: 'inline',
        summaryHtml: '',
        fullHtml: '',
        expanded: false,
        startLine: block.startLine,
        children: [],
      }, block);
      stack[stack.length - 1].children.push(headingNode);
      stack.push(headingNode);

    } else {
      // 非标题内容：处于排除态时一并跳过
      if (skipLevel !== null) continue;

      const parent = stack[stack.length - 1];

      if (block.type === 'listGroup') {
        parent.children.push(buildListGroupNode(block));
      } else if (block.type === 'blockquote') {
        // 普通 > 引用视为对「上一段/上一节点」的补充：
        // 挂到最近的非引用兄弟节点之下；若没有兄弟则挂到父节点（通常是标题）。
        const node = buildBlockNode(block);
        node.isSupplement = true;
        const anchor = lastNonQuoteChild(parent) ?? parent;
        anchor.children.push(node);
      } else {
        parent.children.push(buildBlockNode(block));
      }
    }
  }

  return root;
}

/**
 * 归一化标题文本用于排除匹配：
 * 去掉行首 #、去掉双链语法（[[a|b]]→b、[[a]]→a）、trim、转小写
 */
function normalizeHeading(text: string): string {
  return text
    .replace(/^#{1,6}\s+/, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .trim()
    .toLowerCase();
}

/** 找父节点中最后一个「非引用补充」的子节点，作为引用的挂载锚点 */
function lastNonQuoteChild(parent: MindMapNode): MindMapNode | null {
  for (let i = parent.children.length - 1; i >= 0; i--) {
    if (!parent.children[i].isSupplement) return parent.children[i];
  }
  return null;
}

/** 构建普通块节点（非标题、非列表） */
function buildBlockNode(block: ParsedBlock): MindMapNode {
  return configureNode({
    id: genId(),
    type: block.type,
    renderMode: 'inline',
    summaryHtml: '',
    fullHtml: '',
    expanded: false,
    startLine: block.startLine,
    children: [],
  }, block);
}

/**
 * 构建列表容器节点：整个列表作为一个单元，与前后段落并列（同级）；
 * 列表项作为容器的子节点降一层。容器本身只显示一个轻量标记。
 */
function buildListGroupNode(block: ParsedBlock): MindMapNode {
  const items = block.children?.map(buildListNode) || [];
  return {
    id: genId(),
    type: 'listGroup',
    renderMode: 'static',
    staticHtml: `<span class="mm-list-group">≡ ${items.length}</span>`,
    summaryHtml: '',
    fullHtml: '',
    expanded: false,
    startLine: block.startLine,
    children: items,
  };
}

/** 递归构建列表项节点（保留嵌套层级）；列表项走 inline 渲染以支持双链/格式 */
function buildListNode(block: ParsedBlock): MindMapNode {
  const children = block.children?.map(buildListNode) || [];
  return {
    id: genId(),
    type: 'list',
    renderMode: 'inline',
    markdown: block.raw,
    summaryHtml: '',
    fullHtml: '',
    expanded: false,
    startLine: block.startLine,
    children,
  };
}

/**
 * 根据块类型设置节点的渲染方式与内容来源。
 * - 长段落 / 代码 / 表格 → collapsible（摘要卡片 + 展开）
 * - 其余 → inline（直接渲染原文）
 */
function configureNode(node: MindMapNode, block: ParsedBlock): MindMapNode {
  switch (block.type) {
    case 'heading': {
      // 去掉行首 # 只渲染标题文字（保留其中的双链/格式），字号随层级
      node.markdown = block.raw.replace(/^#{1,6}\s+/, '');
      node.renderMode = 'inline';
      return node;
    }

    case 'paragraph': {
      const text = block.raw.trim();
      if (text.length <= 80 && !text.includes('\n')) {
        node.renderMode = 'inline';
        node.markdown = text;
      } else {
        node.renderMode = 'collapsible';
        node.markdown = text;
        const preview = escapeHtml(oneLine(text).slice(0, 80));
        node.collapsedHtml =
          `<span data-node-id="${node.id}">${preview}… <button class="expand-btn">展开</button></span>`;
      }
      return node;
    }

    case 'code': {
      const firstLine = (block.raw.split('\n')[0] || '').trim();
      const langBadge = block.lang ? escapeHtml(block.lang) : '代码';
      node.renderMode = 'collapsible';
      node.collapsedHtml = `<div class="code-summary" data-node-id="${node.id}">` +
        `<span class="code-lang">${langBadge}</span>` +
        `<code>${escapeHtml(firstLine || '…')}</code>` +
        `<button class="expand-btn">展开</button></div>`;
      // 展开时重新围栏交给 Obsidian 渲染（获得语法高亮）
      const fence = '```' + (block.lang || '') + '\n' + block.raw + '\n```';
      node.markdown = fence;
      return node;
    }

    case 'table': {
      const lines = block.raw.split('\n').filter((l) => l.trim());
      const rows = Math.max(lines.length - 1, 0); // 减去分隔行
      const cols = (lines[0]?.match(/\|/g)?.length || 2) - 1;
      node.renderMode = 'collapsible';
      node.collapsedHtml = `<div class="table-summary" data-node-id="${node.id}">` +
        `📊 表格 (${rows}×${cols})<button class="expand-btn">展开</button></div>`;
      node.markdown = block.raw; // 展开时渲染为真正的 HTML 表格
      return node;
    }

    case 'hr': {
      node.renderMode = 'static';
      node.staticHtml = `<hr class="mm-hr" />`;
      return node;
    }

    // blockquote / callout / image / math / html → inline，直接渲染原文
    default: {
      node.renderMode = 'inline';
      node.markdown = block.raw;
      return node;
    }
  }
}

/** 把多行压成单行预览 */
function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}

function genId(): string {
  return `n${nodeIdCounter++}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
