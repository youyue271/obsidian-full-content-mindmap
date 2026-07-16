/**
 * 树构建器：扁平块数组 → 标题树（块内容挂到所属标题下）
 *
 * 规则：
 * 1. 标题按 level 构建主干树（H1 > H2 > H3 …）
 * 2. 标题与标题之间的所有块内容 → 挂到前一个标题作为子节点
 * 3. 文档开头无标题的内容 → 挂到虚拟根节点
 */

import type { ParsedBlock } from './blockParser';
import type { MindMapNode } from '../types';

let nodeIdCounter = 0;

export function buildTree(blocks: ParsedBlock[], fileName: string): MindMapNode {
  nodeIdCounter = 0;

  const root: MindMapNode = {
    id: genId(),
    type: 'root',
    summaryHtml: `<strong>${escapeHtml(fileName)}</strong>`,
    fullHtml: `<strong>${escapeHtml(fileName)}</strong>`,
    expanded: false,
    startLine: 0,
    children: [],
  };

  // 栈：维护当前的标题层级路径
  const stack: MindMapNode[] = [root];

  for (const block of blocks) {
    if (block.type === 'heading') {
      const level = block.headingLevel!;

      // 弹出栈中 level >= 当前标题的节点
      while (stack.length > 1) {
        const top = stack[stack.length - 1];
        if (top.type === 'heading' && top.headingLevel! >= level) {
          stack.pop();
        } else {
          break;
        }
      }

      // 创建标题节点
      const headingNode: MindMapNode = {
        id: genId(),
        type: 'heading',
        headingLevel: level,
        summaryHtml: renderHeadingHtml(block.raw, level),
        fullHtml: renderHeadingHtml(block.raw, level),
        expanded: false,
        startLine: block.startLine,
        children: [],
      };

      // 挂到栈顶（父标题 或 root）
      stack[stack.length - 1].children.push(headingNode);
      stack.push(headingNode);

    } else if (block.type === 'list') {
      // 列表节点：递归挂载
      const listNode = buildListNode(block);
      stack[stack.length - 1].children.push(listNode);

    } else {
      // 其他块：挂到当前栈顶
      const node = buildBlockNode(block);
      stack[stack.length - 1].children.push(node);
    }
  }

  return root;
}

/**
 * 构建普通块节点（非标题、非列表）
 */
function buildBlockNode(block: ParsedBlock): MindMapNode {
  const id = genId();
  const { summaryHtml, fullHtml } = renderBlockHtml(block, id);

  return {
    id,
    type: block.type,
    summaryHtml,
    fullHtml,
    expanded: false,
    startLine: block.startLine,
    children: [],
  };
}

/**
 * 递归构建列表节点（保留嵌套层级）
 */
function buildListNode(block: ParsedBlock): MindMapNode {
  const children = block.children?.map(buildListNode) || [];

  // 列表项的摘要与完整态相同（短文本不展开）
  const html = `<span class="list-item">${escapeHtml(block.raw)}</span>`;

  return {
    id: genId(),
    type: 'list',
    summaryHtml: html,
    fullHtml: html,
    expanded: false,
    startLine: block.startLine,
    children,
  };
}

/**
 * 渲染标题 HTML
 */
function renderHeadingHtml(text: string, level: number): string {
  const fontSize = Math.max(1.6 - level * 0.1, 1.0);
  return `<span style="font-size: ${fontSize}em; font-weight: 600;">${escapeHtml(text)}</span>`;
}

/**
 * 渲染块 HTML（摘要 + 完整）
 * 注意：这里生成的 HTML 最外层必须有 data-node-id，供 view.ts 的事件代理定位
 */
function renderBlockHtml(block: ParsedBlock, nodeId: string): { summaryHtml: string; fullHtml: string } {
  switch (block.type) {
    case 'paragraph': {
      const text = block.raw;
      if (text.length <= 80) {
        const html = `<span>${escapeHtml(text)}</span>`;
        return { summaryHtml: html, fullHtml: html };
      }
      const summary = `<span data-node-id="${nodeId}">${escapeHtml(text.slice(0, 80))}… <button class="expand-btn">展开</button></span>`;
      const full = `<span data-node-id="${nodeId}">${escapeHtml(text)} <button class="collapse-btn">折叠</button></span>`;
      return { summaryHtml: summary, fullHtml: full };
    }

    case 'code': {
      const lines = block.raw.split('\n');
      const firstLine = lines[0] || '';
      const summary = `<div class="code-summary" data-node-id="${nodeId}">
        <span class="code-lang">代码</span>
        <code>${escapeHtml(firstLine)}</code>
        <button class="expand-btn">展开</button>
      </div>`;
      const full = `<pre data-node-id="${nodeId}"><code>${escapeHtml(block.raw)}</code> <button class="collapse-btn">折叠</button></pre>`;
      return { summaryHtml: summary, fullHtml: full };
    }

    case 'table': {
      const lines = block.raw.split('\n');
      const rows = lines.length;
      const cols = (lines[0]?.match(/\|/g)?.length || 2) - 1;
      const summary = `<div class="table-summary" data-node-id="${nodeId}">
        📊 表格 (${rows}×${cols})
        <button class="expand-btn">展开</button>
      </div>`;
      const full = `<div class="table-full" data-node-id="${nodeId}"><pre>${escapeHtml(block.raw)}</pre> <button class="collapse-btn">折叠</button></div>`;
      return { summaryHtml: summary, fullHtml: full };
    }

    case 'image': {
      // 解析 ![alt](url)
      const match = block.raw.match(/!\[([^\]]*)\]\(([^)]+)\)/);
      const url = match?.[2] || '';
      const alt = match?.[1] || 'image';
      const summary = `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" style="max-width: 120px; max-height: 80px; border-radius: 4px;" />`;
      const full = `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" style="max-width: 300px; border-radius: 4px;" />`;
      return { summaryHtml: summary, fullHtml: full };
    }

    case 'blockquote': {
      const html = `<blockquote style="border-left: 3px solid #aaa; padding-left: 8px; font-style: italic;">${escapeHtml(block.raw)}</blockquote>`;
      return { summaryHtml: html, fullHtml: html };
    }

    case 'callout': {
      const html = `<div class="callout" style="border-left: 3px solid #4a9eff; padding-left: 8px; background: rgba(74, 158, 255, 0.1);">${escapeHtml(block.raw)}</div>`;
      return { summaryHtml: html, fullHtml: html };
    }

    case 'hr': {
      const html = `<hr style="border: none; border-top: 1px solid #ccc;" />`;
      return { summaryHtml: html, fullHtml: html };
    }

    case 'html': {
      // 直接渲染 HTML（注意安全风险，MVP 阶段先保留）
      return { summaryHtml: block.raw, fullHtml: block.raw };
    }

    case 'math': {
      // 暂时用纯文本显示公式，后期接入 KaTeX
      const html = `<code class="math">$$ ${escapeHtml(block.raw)} $$</code>`;
      return { summaryHtml: html, fullHtml: html };
    }

    default: {
      const html = `<span>${escapeHtml(block.raw)}</span>`;
      return { summaryHtml: html, fullHtml: html };
    }
  }
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
