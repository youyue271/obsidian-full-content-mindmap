/**
 * markmap-view 封装层
 *
 * 层级选项说明：
 *  -999 (FULL_EXPAND) → initialExpandLevel: -1，全展开，无 fold
 *  1–5               → initialExpandLevel: N，展开到第 N 层
 *  -1, -2, -3        → 全展开 + 按深度精确 fold：
 *                       "收拢最后N层" = fold 深度 >= (maxDepth - N + 1) 的节点，
 *                       即隐藏最深 N 层叶子，较浅分支不受影响（尽可能多展示）
 */

import { Markmap } from 'markmap-view';
import type { MindMapNode, IMarkmapNode } from '../types';

/** 全部展开的哨兵值（下拉选项 value='-999'） */
const FULL_EXPAND = -999;

export interface MarkmapController {
  setData(root: MindMapNode): void;
  fit(): void;
  /** 切换展开/收拢模式，level 含义见文件顶部注释 */
  expandTo(level: number): void;
  getLevel(): number;
  destroy(): void;
}

export function createMarkmap(svgEl: SVGSVGElement, initialLevel = FULL_EXPAND): MarkmapController {
  let level = initialLevel;
  let lastRoot: MindMapNode | null = null;

  const mm = Markmap.create(svgEl, {
    duration: 300,
    maxWidth: 260,
    initialExpandLevel: -1,   // 由 apply() 统一管控，这里只设初始值
    spacingHorizontal: 40,
    spacingVertical: 6,
    paddingX: 12,
  });

  function apply() {
    if (!lastRoot) return;

    if (level === FULL_EXPAND) {
      // 全展开
      mm.setData(toIMarkmapNode(lastRoot) as any, { initialExpandLevel: -1 });
      return;
    }

    if (level >= 1) {
      // 绝对层级：第 N 层
      mm.setData(toIMarkmapNode(lastRoot) as any, { initialExpandLevel: level });
      return;
    }

    // 收拢最后 N 层：level 为 -1/-2/-3
    // "收拢最后N层" 含义：把最深的 N 层叶子折叠起来
    // 实现：fold 深度 >= (maxDepth - N + 1) 的节点，使其子节点不可见
    const n = -level;
    const maxDepth = getMaxDepth(lastRoot);
    const foldFromDepth = Math.max(1, maxDepth - n + 1);
    mm.setData(toIMarkmapNode(lastRoot, 0, foldFromDepth) as any, { initialExpandLevel: -1 });
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
      level = newLevel;
      apply();
    },
    getLevel() {
      return level;
    },
    destroy() {
      svgEl.innerHTML = '';
    },
  };
}

/**
 * 递归把 MindMapNode 转成 markmap 的 IMarkmapNode
 * @param foldFromDepth 若指定，深度 >= 该值的节点设 fold:1
 */
export function toIMarkmapNode(
  node: MindMapNode,
  depth = 0,
  foldFromDepth: number | null = null,
): IMarkmapNode {
  const shouldFold = foldFromDepth !== null && depth >= foldFromDepth;
  return {
    type: node.type,
    depth,
    content: node.expanded ? node.fullHtml : node.summaryHtml,
    children: node.children.map((c) => toIMarkmapNode(c, depth + 1, foldFromDepth)),
    payload: {
      id: node.id,
      fold: shouldFold ? 1 : undefined,
      startLine: node.startLine,
    },
  };
}

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

function getMaxDepth(node: MindMapNode, currentDepth = 0): number {
  if (node.children.length === 0) return currentDepth;
  return Math.max(...node.children.map((c) => getMaxDepth(c, currentDepth + 1)));
}
