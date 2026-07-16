/**
 * markmap-view 封装层
 *
 * 职责：
 * 1. 在给定 SVG 元素上创建 Markmap 实例
 * 2. 把 MindMapNode 树转成 markmap 的 IMarkmapNode 格式
 * 3. 处理节点展开/折叠，展开后重新布局
 */

import { Markmap } from 'markmap-view';
import type { MindMapNode, IMarkmapNode } from '../types';

export interface MarkmapController {
  /** 更新整棵树 */
  setData(root: MindMapNode): void;
  /** 缩放到适合视口 */
  fit(): void;
  /** 销毁 */
  destroy(): void;
}

/**
 * 在 svgEl 上创建一个 Markmap 实例，返回控制器
 */
export function createMarkmap(svgEl: SVGSVGElement): MarkmapController {
  const mm = Markmap.create(svgEl, {
    duration: 300,
    maxWidth: 260,       // 限制宽度，配合 CSS nowrap→normal 触发换行
    initialExpandLevel: 2,
    spacingHorizontal: 40,
    spacingVertical: 6,
    paddingX: 12,
  });

  return {
    setData(root: MindMapNode) {
      mm.setData(toIMarkmapNode(root) as any);
    },
    fit() {
      mm.fit();
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
  // heading / root / list 节点不折叠；内容节点超过 depth 2 时默认折叠
  const fold = shouldFoldByDefault(node) ? 1 : 0;

  return {
    type: node.type,
    depth,
    content: node.expanded ? node.fullHtml : node.summaryHtml,
    children: node.children.map((c) => toIMarkmapNode(c, depth + 1)),
    payload: {
      id: node.id,
      fold,
      startLine: node.startLine,
    },
  };
}

/**
 * 深层内容节点默认折叠，避免首次渲染太乱
 * 策略：叶子节点 depth >= 3 时折叠
 */
function shouldFoldByDefault(node: MindMapNode): boolean {
  if (node.type === 'root' || node.type === 'heading') return false;
  return true;
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
