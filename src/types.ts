/**
 * 插件核心数据结构
 *
 * MindMapNode 是连接"解析层"与"渲染层"的桥梁：
 * - 解析层把 markdown 切成带原文的块树
 * - 渲染层（view.ts）用 Obsidian 的 MarkdownRenderer 把原文渲染成 HTML，
 *   填入 summaryHtml / fullHtml，再交给 markmap-view 布局
 */

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'code'
  | 'table'
  | 'blockquote'
  | 'list'       // 单个列表项（listItem），保留嵌套层级
  | 'listGroup'  // 一整个列表的容器（其子节点为各 list 项），使列表作为整体与兄弟段落并列
  | 'image'
  | 'math'       // 独立行内 $$ ... $$ 数学公式
  | 'callout'    // Obsidian callout (> [!NOTE])
  | 'hr'         // thematicBreak
  | 'html'       // raw HTML 块
  | 'root';      // 虚拟根节点（文件名）

/**
 * 节点渲染方式：
 * - static：固定 HTML，不走 markdown 渲染（根节点文件名、分割线）
 * - inline：始终渲染 markdown 原文（标题、短段落、callout、引用、图片、列表、公式）
 * - collapsible：默认显示摘要卡片，点击展开渲染完整内容（长段落、代码、表格）
 */
export type RenderMode = 'static' | 'inline' | 'collapsible';

export interface MindMapNode {
  /** 唯一 ID，格式 "n{i}"，用于点击展开/折叠的定位 */
  id: string;

  /** 当前节点的块类型 */
  type: BlockType;

  /** 标题级别（仅 type==='heading' 时有效，1–6） */
  headingLevel?: number;

  /** 渲染方式 */
  renderMode: RenderMode;

  /** static：固定 HTML（已转义，不再走 markdown 渲染） */
  staticHtml?: string;

  /**
   * 需要经 Obsidian 渲染的 markdown 原文。
   * - inline：始终渲染这段
   * - collapsible：展开时渲染这段（除非提供了 expandedHtml）
   */
  markdown?: string;

  /** collapsible：折叠态摘要卡片 HTML（徽标 + 展开按钮） */
  collapsedHtml?: string;

  /** collapsible：展开态直接使用的现成 HTML（代码块用，避免再次围栏） */
  expandedHtml?: string;

  /** 由 view.ts 渲染后填入：摘要态最终 HTML（markmap 消费） */
  summaryHtml: string;

  /** 由 view.ts 渲染后填入：完整态最终 HTML */
  fullHtml: string;

  /** 是否当前处于展开态 */
  expanded: boolean;

  /** 是否为"补充说明"节点（如 > 引用），渲染时加视觉标记挂在上一节点下方 */
  isSupplement?: boolean;

  /** 该块在源文件中的起始行（0-based），用于点击跳转 */
  startLine: number;

  /** 子节点 */
  children: MindMapNode[];
}

/** markmap-view 所需的 INode 格式（自定义，避免引入 markmap-lib 类型依赖） */
export interface IMarkmapNode {
  type: string;
  depth: number;
  content: string;
  children: IMarkmapNode[];
  payload?: {
    id?: string;
    fold?: number;  // 0=展开, 1=折叠
    startLine?: number;
  };
}
