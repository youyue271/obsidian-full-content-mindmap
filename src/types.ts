/**
 * 插件核心数据结构
 *
 * MindMapNode 是连接"解析层"与"渲染层"的桥梁：
 * - 解析层把 markdown AST 转成这棵树
 * - 渲染层把这棵树转成 markmap-view 需要的 INode（content = summaryHtml / fullHtml）
 */

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'code'
  | 'table'
  | 'blockquote'
  | 'list'       // 单个列表项（listItem），保留嵌套层级
  | 'image'
  | 'math'       // 独立行内 $$ ... $$ 数学公式
  | 'callout'    // Obsidian callout (> [!NOTE])
  | 'hr'         // thematicBreak
  | 'html'       // raw HTML 块
  | 'root';      // 虚拟根节点（文件名）

export interface MindMapNode {
  /** 唯一 ID，格式 "n{i}"，用于点击展开/折叠的定位 */
  id: string;

  /** 当前节点的块类型 */
  type: BlockType;

  /** 标题级别（仅 type==='heading' 时有效，1–6） */
  headingLevel?: number;

  /**
   * 摘要态 HTML：
   * - heading/list/root → 直接是全部内容（短，无需展开）
   * - paragraph → 首 80 字 + "…" + 展开按钮
   * - code → 语言徽标 + 首行 + 展开按钮
   * - table → 「表格 NxM」徽标 + 展开按钮
   * - 其余 → 尽量压缩
   */
  summaryHtml: string;

  /**
   * 完整态 HTML（点击后展示）。
   * 对于不可展开的节点（heading/list）与 summaryHtml 相同。
   */
  fullHtml: string;

  /** 是否当前处于展开态 */
  expanded: boolean;

  /** 该块在源文件中的起始行（0-based），用于点击跳转 */
  startLine: number;

  /** 子节点 */
  children: MindMapNode[];
}

/** markmap-view 所需的 INode 格式（自定义，避免引入 markmap-lib 类型依赖） */
export interface IMarkmapNode {
  content: string;
  children: IMarkmapNode[];
  payload?: {
    id?: string;
    fold?: number;  // 0=展开, 1=折叠
    startLine?: number;
  };
}
