/**
 * 解析器：markdown 文本 → 块级 AST
 *
 * 使用 unified + remark-parse + remark-gfm
 * 返回扁平的块数组，每个块包含类型、内容、行号
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root, Content, Heading, Paragraph, Code, Blockquote, List, ListItem, Table, Image, Html, ThematicBreak } from 'mdast';
import type { BlockType } from '../types';

export interface ParsedBlock {
  type: BlockType;
  headingLevel?: number;
  raw: string;              // 原始 markdown 文本
  startLine: number;        // 0-based 行号
  children?: ParsedBlock[]; // 仅 list 用，保留嵌套结构
}

/**
 * 剥离文件头部的 YAML frontmatter（--- ... ---）。
 * 用等量空行替换，保留后续内容的行号，方便点击跳转定位。
 */
function stripFrontmatter(content: string): string {
  // 必须从文件最开头开始
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return content;

  const matched = match[0];
  const newlineCount = (matched.match(/\r?\n/g) || []).length;
  // 用等量换行替换，保持后续行号不变
  return '\n'.repeat(newlineCount) + content.slice(matched.length);
}

/**
 * 解析 markdown 为块数组
 */
export function parseMarkdown(content: string): ParsedBlock[] {
  const stripped = stripFrontmatter(content);

  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(stripped);

  const blocks: ParsedBlock[] = [];

  function visitNode(node: Content, startLine: number) {
    const pos = node.position;
    const line = pos?.start.line ? pos.start.line - 1 : startLine;

    switch (node.type) {
      case 'heading': {
        const h = node as Heading;
        blocks.push({
          type: 'heading',
          headingLevel: h.depth,
          raw: extractText(h),
          startLine: line,
        });
        break;
      }

      case 'paragraph': {
        const p = node as Paragraph;
        blocks.push({
          type: 'paragraph',
          raw: extractText(p),
          startLine: line,
        });
        break;
      }

      case 'code': {
        const c = node as Code;
        blocks.push({
          type: 'code',
          raw: c.value,
          startLine: line,
        });
        break;
      }

      case 'blockquote': {
        const bq = node as Blockquote;
        // 检查是否是 Obsidian callout: > [!TYPE]
        const firstChild = bq.children[0];
        const isCallout = firstChild?.type === 'paragraph' &&
          extractText(firstChild).match(/^\[![\w-]+\]/);

        blocks.push({
          type: isCallout ? 'callout' : 'blockquote',
          raw: extractText(bq),
          startLine: line,
        });
        break;
      }

      case 'list': {
        const list = node as List;
        // 递归解析列表项
        const listBlocks = parseListItems(list.children, line);
        blocks.push(...listBlocks);
        break;
      }

      case 'table': {
        const t = node as Table;
        blocks.push({
          type: 'table',
          raw: serializeTable(t),
          startLine: line,
        });
        break;
      }

      case 'image': {
        const img = node as Image;
        blocks.push({
          type: 'image',
          raw: `![${img.alt || ''}](${img.url})`,
          startLine: line,
        });
        break;
      }

      case 'html': {
        const html = node as Html;
        blocks.push({
          type: 'html',
          raw: html.value,
          startLine: line,
        });
        break;
      }

      case 'thematicBreak': {
        blocks.push({
          type: 'hr',
          raw: '---',
          startLine: line,
        });
        break;
      }

      case 'math': {
        // @ts-ignore remark-gfm 可能注入 math 节点
        const math = node as any;
        blocks.push({
          type: 'math',
          raw: math.value || '',
          startLine: line,
        });
        break;
      }
    }
  }

  if (tree.type === 'root') {
    (tree as Root).children.forEach((child, i) => visitNode(child, i));
  }

  return blocks;
}

/**
 * 递归解析列表项，保留嵌套结构
 */
function parseListItems(items: ListItem[], startLine: number): ParsedBlock[] {
  return items.map((item, i) => {
    const line = item.position?.start.line ? item.position.start.line - 1 : startLine + i;
    const text = extractText(item);

    // 检查是否是任务列表
    const checked = item.checked;
    const raw = checked !== null && checked !== undefined
      ? `[${checked ? 'x' : ' '}] ${text}`
      : text;

    // 如果列表项内部嵌套了子列表，递归
    const nestedList = item.children.find((c: any) => c.type === 'list') as List | undefined;
    const children = nestedList ? parseListItems(nestedList.children, line) : undefined;

    return {
      type: 'list',
      raw,
      startLine: line,
      children,
    };
  });
}

/**
 * 从 AST 节点提取纯文本
 */
function extractText(node: any): string {
  if (typeof node.value === 'string') return node.value;
  if (Array.isArray(node.children)) {
    return node.children.map(extractText).join('');
  }
  if (node.type === 'text') return node.value;
  if (node.type === 'inlineCode') return `\`${node.value}\``;
  if (node.type === 'emphasis') return `_${extractText(node)}_`;
  if (node.type === 'strong') return `**${extractText(node)}**`;
  if (node.type === 'link') return `[${extractText(node)}](${node.url})`;
  if (node.type === 'image') return `![${node.alt}](${node.url})`;
  return '';
}

/**
 * 简单序列化表格为 markdown（用于后续渲染）
 */
function serializeTable(table: Table): string {
  return table.children.map(row => {
    return '| ' + row.children.map(cell => extractText(cell)).join(' | ') + ' |';
  }).join('\n');
}
