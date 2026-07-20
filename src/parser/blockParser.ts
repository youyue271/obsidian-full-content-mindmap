/**
 * 解析器：markdown 文本 → 块级数组
 *
 * 使用 unified + remark-parse + remark-gfm 定位每个块的边界，
 * 但**内容取源文件原文切片**（而非重建），以保留 Obsidian 专有语法：
 * [[双链]]、==高亮==、> [!NOTE] callout、$$公式$$ 等。
 * 这些原文之后交给 Obsidian 的 MarkdownRenderer 渲染。
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root, Content, Heading, Blockquote, List, ListItem } from 'mdast';
import type { BlockType } from '../types';

export interface ParsedBlock {
  type: BlockType;
  headingLevel?: number;
  raw: string;              // 源文件原文切片（含 markdown 语法）
  rawEdit?: string;         // 写回文件用的完整原文（code 含围栏、list 含标记）；缺省用 raw
  lang?: string;            // 仅 code：语言标识
  startLine: number;        // 0-based 起始行号
  endLine: number;          // 0-based 结束行号（写回时替换 startLine~endLine）
  children?: ParsedBlock[]; // listGroup：列表项；list：嵌套子项
}

/**
 * 剥离文件头部的 YAML frontmatter（--- ... ---）。
 * 用等量空行替换，保留后续内容的行号与字符偏移，方便点击跳转与原文切片定位。
 */
function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return content;

  const matched = match[0];
  const newlineCount = (matched.match(/\r?\n/g) || []).length;
  return '\n'.repeat(newlineCount) + content.slice(matched.length);
}

/**
 * 解析 markdown 为块数组
 */
export function parseMarkdown(content: string): ParsedBlock[] {
  // 注意：remark 解析的是 stripped，后续所有 offset 都相对 stripped
  const src = stripFrontmatter(content);

  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(src);

  const blocks: ParsedBlock[] = [];

  /** 用 position 偏移从源码切出原文 */
  function slice(node: Content): string {
    const s = node.position?.start.offset;
    const e = node.position?.end.offset;
    if (typeof s === 'number' && typeof e === 'number') {
      return src.slice(s, e);
    }
    return '';
  }

  function lineOf(node: Content, fallback: number): number {
    return node.position?.start.line ? node.position.start.line - 1 : fallback;
  }

  function endLineOf(node: Content, fallback: number): number {
    return node.position?.end.line ? node.position.end.line - 1 : fallback;
  }

  function visitNode(node: Content, index: number) {
    const line = lineOf(node, index);
    const endLine = endLineOf(node, line);

    // 用 string 判别：math 等由额外插件注入的节点类型不在 mdast Content 联合里
    switch (node.type as string) {
      case 'heading': {
        const h = node as Heading;
        const raw = slice(node);
        blocks.push({ type: 'heading', headingLevel: h.depth, raw, startLine: line, endLine, rawEdit: raw });
        break;
      }
      case 'paragraph': {
        const raw = slice(node);
        const trimmed = raw.trim();

        // 检测是否包含 ![[...]] 嵌入
        const hasEmbed = /!\[\[[^\]]+\]\]/.test(trimmed);

        if (!hasEmbed) {
          // 无嵌入：普通段落（整段可编辑）
          blocks.push({ type: 'paragraph', raw, startLine: line, endLine, rawEdit: raw });
        } else {
          // 含嵌入：按 ![[...]] 边界拆分成独立块
          // "前文\n![[A]]\n![[B]]中间\n![[C]]后文" → [前文, ![[A]], ![[B]], 中间, ![[C]], 后文]
          const parts: string[] = [];
          const embedRe = /!\[\[[^\]]+\]\]/g;
          let lastIndex = 0;
          let m: RegExpExecArray | null;

          while ((m = embedRe.exec(trimmed)) !== null) {
            // m.index 前的非 embed 文本
            if (m.index > lastIndex) {
              const textPart = trimmed.slice(lastIndex, m.index).trim();
              if (textPart) parts.push(textPart);
            }
            // embed 本身
            parts.push(m[0]);
            lastIndex = embedRe.lastIndex;
          }
          // 最后剩余的文本
          if (lastIndex < trimmed.length) {
            const textPart = trimmed.slice(lastIndex).trim();
            if (textPart) parts.push(textPart);
          }

          // 每个 part 生成一个块：embed → embed 节点，text → paragraph 节点
          parts.forEach((part) => {
            if (/^!\[\[[^\]]+\]\]$/.test(part)) {
              blocks.push({ type: 'embed', raw: part, startLine: line, endLine });
            } else {
              blocks.push({ type: 'paragraph', raw: part, startLine: line, endLine, rawEdit: part });
            }
          });
        }
        break;
      }
      case 'code': {
        // raw 只保留代码正文，语言单独存，展开时由 view 重新围栏以获得高亮
        // rawEdit 用完整原文（含 ``` 围栏），供编辑回写
        const c = node as any;
        blocks.push({ type: 'code', raw: c.value ?? '', lang: c.lang || '', startLine: line, endLine, rawEdit: slice(node) });
        break;
      }
      case 'blockquote': {
        const bq = node as Blockquote;
        const first = bq.children[0];
        // Obsidian callout: > [!TYPE]
        const isCallout = first?.type === 'paragraph' &&
          /^\[![\w-]+\]/.test(slice(first).trim().replace(/^>\s*/, ''));
        const raw = slice(node);
        blocks.push({ type: isCallout ? 'callout' : 'blockquote', raw, startLine: line, endLine, rawEdit: raw });
        break;
      }
      case 'list': {
        const list = node as List;
        // 顶层列表整体作为一个容器块（listGroup），列表项作为其 children。
        // 这样"列表前后的段落"与"整个列表"并列，而非与列表的项并列。
        blocks.push({
          type: 'listGroup',
          raw: '',
          startLine: line,
          endLine,
          children: parseListItems(list.children, line),
        });
        break;
      }
      case 'table': {
        const raw = slice(node);
        blocks.push({ type: 'table', raw, startLine: line, endLine, rawEdit: raw });
        break;
      }
      case 'html': {
        blocks.push({ type: 'html', raw: slice(node), startLine: line, endLine });
        break;
      }
      case 'thematicBreak': {
        blocks.push({ type: 'hr', raw: '---', startLine: line, endLine });
        break;
      }
      case 'math': {
        // @ts-ignore remark 插件可能注入 math 节点
        const raw = slice(node);
        blocks.push({ type: 'math', raw, startLine: line, endLine, rawEdit: raw });
        break;
      }
      // paragraph 内的图片会被当作段落处理；独立图片行也是 paragraph，交给 Obsidian 渲染
    }
  }

  /**
   * 递归解析列表项，保留嵌套层级；每项取自身原文（不含子列表）
   */
  function parseListItems(items: ListItem[], parentLine: number): ParsedBlock[] {
    return items.map((item, i) => {
      const line = lineOf(item, parentLine + i);

      const nested = item.children.find((c: any) => c.type === 'list') as List | undefined;

      const itemStart = item.position?.start.offset ?? 0;
      const itemEnd = item.position?.end.offset ?? itemStart;
      // 边界取到嵌套子列表起点，因此 ownText 只含列表项自身文本（不含子项）
      const boundary = nested?.position?.start.offset ?? itemEnd;
      const ownText = src.slice(itemStart, boundary);

      // endLine 按「自身文本占用的行数」计算，绝不能用 item.position.end——
      // remark 里含嵌套子列表的列表项，其 position.end 会延伸到整个子列表末尾，
      // 那样写回会连子项一起覆盖删除。
      const ownLineCount = ownText.replace(/\s+$/, '').split('\n').length;
      const endLine = line + ownLineCount - 1;

      const rawEdit = ownText.replace(/\s+$/, '');       // 含列表标记的自身原文，用于写回
      const text = dedentListItem(ownText);              // 去标记后的正文，用于渲染

      const children = nested ? parseListItems(nested.children, line) : undefined;

      return { type: 'list', raw: text, rawEdit, startLine: line, endLine, children } as ParsedBlock;
    });
  }

  if (tree.type === 'root') {
    (tree as Root).children.forEach((child, i) => visitNode(child, i));
  }

  return blocks;
}

/**
 * 去掉列表项行首缩进和列表标记，保留任务复选框（[ ] / [x]）与正文（含 markdown 语法）
 */
function dedentListItem(text: string): string {
  const trimmed = text.replace(/\s+$/, '');
  // 去掉首行的缩进 + 标记：可选空白、- * + 或数字. 、一个空格
  return trimmed.replace(/^[ \t]*(?:[-*+]|\d+[.)])\s+/, '');
}
