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
  /** 完整重建（文件渲染或层级变更时调用），按当前 level 重新折叠 */
  setData(root: MindMapNode): void;
  /** 仅更新节点内容（折叠卡片展开/收拢），保留用户通过折叠圆圈手动设置的折叠状态 */
  updateContent(root: MindMapNode): void;
  fit(): void;
  expandTo(level: number): void;
  getLevel(): number;
  /** 更新节点最大宽度（设置变更时调用），随后需重新 setData 生效 */
  setMaxWidth(w: number): void;
  destroy(): void;
}

export function createMarkmap(svgEl: SVGSVGElement, initialLevel = FULL_EXPAND, maxWidth = 360): MarkmapController {
  let level = initialLevel;
  let lastRoot: MindMapNode | null = null;

  const mm = Markmap.create(svgEl, {
    duration: 300,
    maxWidth,
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
    updateContent(root: MindMapNode) {
      lastRoot = root;
      // 从 markmap 当前 state.data 中采集 {nodeId → currentFold}，
      // 再用这些 fold 值重建 IMarkmapNode，保留用户手动设置的折叠状态
      const liveFolds = new Map<string, number | undefined>();
      const stateData = (mm as any).state?.data;
      if (stateData) collectLiveFolds(stateData, liveFolds);

      mm.setData(toIMarkmapNodeWithFolds(root, 0, liveFolds) as any, {
        initialExpandLevel: -1,
      });
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
    setMaxWidth(w: number) {
      mm.setOptions({ maxWidth: w });
      apply();
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

/**
 * 从 markmap 内部的 INode 树递归采集 {payload.id → payload.fold}。
 * markmap 的 toggleNode 直接改 payload.fold，这里读出来用于 updateContent。
 */
function collectLiveFolds(node: any, out: Map<string, number | undefined>): void {
  const id = node?.payload?.id;
  if (id) out.set(id, node.payload.fold);
  if (Array.isArray(node?.children)) {
    node.children.forEach((c: any) => collectLiveFolds(c, out));
  }
}

/**
 * 重建 IMarkmapNode，内容取自 MindMapNode，fold 取自 liveFolds（保留用户手动折叠状态）。
 */
function toIMarkmapNodeWithFolds(
  node: MindMapNode,
  depth: number,
  liveFolds: Map<string, number | undefined>,
): IMarkmapNode {
  return {
    type: node.type,
    depth,
    content: node.expanded ? node.fullHtml : node.summaryHtml,
    children: node.children.map((c) => toIMarkmapNodeWithFolds(c, depth + 1, liveFolds)),
    payload: {
      id: node.id,
      fold: liveFolds.has(node.id) ? liveFolds.get(node.id) : undefined,
      startLine: node.startLine,
    },
  };
}
