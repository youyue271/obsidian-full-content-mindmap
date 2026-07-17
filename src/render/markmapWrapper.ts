/**
 * markmap-view 封装层
 *
 * 职责：
 * 1. 在给定 SVG 元素上创建 Markmap 实例
 * 2. 把 MindMapNode 树转成 markmap 的 IMarkmapNode 格式
 * 3. 处理节点展开/折叠，展开后重新布局
 * 4. 控制默认展开层级（可由工具栏动态切换）
 */

import { Markmap } from 'markmap-view';
import type { MindMapNode, IMarkmapNode } from '../types';

export interface MarkmapController {
  /** 更新整棵树 */
  setData(root: MindMapNode): void;
  /** 缩放到适合视口 */
  fit(): void;
  /** 展开到指定层级（-1 = 全部展开），并记住该层级 */
  expandTo(level: number): void;
  /** 当前的展开层级 */
  getLevel(): number;
  /** 销毁 */
  destroy(): void;
}

/**
 * 在 svgEl 上创建一个 Markmap 实例，返回控制器
 * @param initialLevel 初始默认展开层级（-1 = 全部展开）
 */
export function createMarkmap(svgEl: SVGSVGElement, initialLevel = -1): MarkmapController {
  // 展开层级是「粘性」的：折叠卡片的 toggle、resize 等重绘都沿用它，
  // 只有用户显式切换层级时才改变，避免重绘时把树抖回默认层级。
  let level = initialLevel;
  let lastRoot: MindMapNode | null = null;

  const mm = Markmap.create(svgEl, {
    duration: 300,
    maxWidth: 260,       // 限制宽度，配合 CSS nowrap→normal 触发换行
    initialExpandLevel: initialLevel,
    spacingHorizontal: 40,
    spacingVertical: 6,
    paddingX: 12,
  });

  function apply() {
    if (!lastRoot) return;
    mm.setData(toIMarkmapNode(lastRoot) as any, { initialExpandLevel: level });
  }

  return {
    setData(root: MindMapNode) {
      lastRoot = root;
      apply();
    },
    fit() {
      mm.fit();
    },
    expandTo(newLevel: number) {
      let actualLevel = newLevel;
      if (newLevel < 0 && lastRoot) {
        // 负数 = 相对于最大深度的收拢：-1 → maxDepth-1（收拢最后1层）
        const maxDepth = getMaxDepth(lastRoot);
        actualLevel = Math.max(1, maxDepth + newLevel);
      }
      level = actualLevel;
      apply();
    },
    getLevel() {
      return level;
    },
    destroy() {
      // markmap-view 暂无官方 destroy，清理 SVG 内容即可
      svgEl.innerHTML = '';
    },
  };
}

/**
 * 递归把 MindMapNode 转成 markmap 需要的 IMarkmapNode
 */
export function toIMarkmapNode(node: MindMapNode, depth = 0): IMarkmapNode {
  return {
    type: node.type,
    depth,
    content: node.expanded ? node.fullHtml : node.summaryHtml,
    children: node.children.map((c) => toIMarkmapNode(c, depth + 1)),
    payload: {
      id: node.id,
      // 不强制折叠：交给 markmap 的 initialExpandLevel 统一控制，避免隐藏列表项等子内容
      startLine: node.startLine,
    },
  };
}

/**
 * 在 MindMapNode 树中按 id 找节点，切换展开状态，返回 true 表示找到
 */
export function toggleNodeExpansion(root: MindMapNode, nodeId: string): boolean {
  if (root.id === nodeId) {
    root.expanded = !root.expanded;
    return true;
  }
  for (const child of root.children) {
    if (toggleNodeExpansion(child, nodeId)) return true;
  }
  return false;
}

/**
 * 计算树的最大深度（根节点深度为 0）
 */
function getMaxDepth(node: MindMapNode, currentDepth = 0): number {
  if (node.children.length === 0) return currentDepth;
  return Math.max(...node.children.map((c) => getMaxDepth(c, currentDepth + 1)));
}
