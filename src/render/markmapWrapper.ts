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

    // 收拢最后 N 层（level 为 -1/-2/-3）：
    // 反复"收掉当前所有叶子" N 次，等价于折叠「高度」在 1..N 的节点
    // （高度 = 到子树最深叶子的距离，叶子高度 0）。祖先折叠会覆盖后代，
    // 于是每个分支各自从最深处往上收 N 层，浅分支收不满则收到底为止。
    const n = -level;
    const heights = new Map<string, number>();
    computeHeights(lastRoot, heights);
    const foldFn = (node: MindMapNode) => {
      const h = heights.get(node.id) ?? 0;
      return h >= 1 && h <= n;
    };
    mm.setData(toIMarkmapNode(lastRoot, 0, foldFn) as any, { initialExpandLevel: -1 });
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
 * @param shouldFold 若提供，返回 true 的节点设 fold:1（隐藏其子树）
 */
export function toIMarkmapNode(
  node: MindMapNode,
  depth = 0,
  shouldFold: ((node: MindMapNode) => boolean) | null = null,
): IMarkmapNode {
  const fold = shouldFold && shouldFold(node) ? 1 : undefined;
  return {
    type: node.type,
    depth,
    content: node.expanded ? node.fullHtml : node.summaryHtml,
    children: node.children.map((c) => toIMarkmapNode(c, depth + 1, shouldFold)),
    payload: {
      id: node.id,
      fold,
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

/**
 * 计算每个节点的「高度」（到其子树最深叶子的距离，叶子高度 0），写入 map。
 * 返回本节点高度。
 */
function computeHeights(node: MindMapNode, out: Map<string, number>): number {
  if (node.children.length === 0) {
    out.set(node.id, 0);
    return 0;
  }
  const h = 1 + Math.max(...node.children.map((c) => computeHeights(c, out)));
  out.set(node.id, h);
  return h;
}
