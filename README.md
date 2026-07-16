# Full Content MindMap

一个 Obsidian 插件，将当前 markdown 文件的**所有内容**（标题、段落、代码块、表格、图片、列表等）渲染为思维导图。

## 核心特性

✅ **完整内容渲染** — 不只是标题大纲，而是整篇文档的每个块都在图中呈现  
✅ **智能摘要卡片** — 长段落/代码/表格默认显示摘要，点击展开查看全文  
✅ **自动布局** — 基于 markmap 的树形布局算法，自适应节点尺寸  
✅ **点击跳转** — 点击节点跳转到源文件对应位置  
✅ **主题跟随** — 自动跟随 Obsidian 明暗主题  
✅ **实时刷新** — 文件修改后自动更新思维导图

## 与竞品的区别

市面上的思维导图插件（Markmind、Enhancing Mindmap、Light Mindmap 等）大多只渲染**标题+列表**，而本插件渲染整篇文档的**所有块类型**：

| 内容类型 | 传统插件 | 本插件 |
|---------|---------|--------|
| 标题 | ✅ | ✅ |
| 列表 | ✅ | ✅ |
| 段落 | ❌ | ✅（超长截断+展开） |
| 代码块 | ❌ | ✅（摘要卡片+展开） |
| 表格 | ❌ | ✅（行列数摘要+展开） |
| 图片 | ❌ | ✅（缩略图） |
| 引用/Callout | ❌ | ✅ |

## 安装

### 手动安装（开发版）

1. 将本项目克隆或下载到你的 vault 的 `.obsidian/plugins/` 目录下：
   ```bash
   cd /path/to/your-vault/.obsidian/plugins/
   git clone <repo-url> full-content-mindmap
   cd full-content-mindmap
   npm install
   npm run build
   ```

2. 在 Obsidian 设置 → 第三方插件 → 启用「Full Content MindMap」

3. 使用命令面板（Ctrl/Cmd+P）→ 输入「切换思维导图 / 文档」

## 使用

1. 打开一个 markdown 文件
2. 执行命令「切换思维导图 / 文档」——当前标签页原地切换到思维导图
3. 再次执行同一命令即可切回文档编辑模式（双向切换）
4. 节点内容由 Obsidian 自身渲染，支持双链 `[[...]]`、`> [!NOTE]` callout、表格、代码高亮、公式等
5. 点击双链跳转到对应笔记；长段落/代码/表格点「展开」查看完整内容

## 技术架构

```
解析层：unified + remark-parse + remark-gfm
       ↓
       扁平块数组 (ParsedBlock[])
       ↓
构建层：按标题层级建树，块内容挂到所属标题下
       ↓
       MindMapNode 树
       ↓
渲染层：markmap-view 布局 + 自绘 HTML 节点
       ↓
       SVG 思维导图
```

## 开发路线图

- [x] MVP：完整块类型解析 + 摘要卡片 + 基础渲染
- [ ] V2：节点展开/折叠动画优化 + 点击跳转增强
- [ ] V3：代码高亮（highlight.js）+ 表格完整渲染 + 数学公式（KaTeX）
- [ ] V4：导出 PNG/SVG + 任务列表勾选回写 + 自定义样式设置

## 渲染说明

节点内容统一交给 Obsidian 的 `MarkdownRenderer` 渲染，因此：

- 双链 `[[...]]`、`> [!NOTE]` callout、表格、代码高亮、`$$公式$$` 均按 Obsidian 原生效果显示
- 主题、字体、callout 图标等自动跟随当前 Obsidian 主题
- 长段落 / 代码 / 表格默认折叠成摘要卡片，点「展开」渲染完整内容

## 已知限制

- 依赖 KaTeX/Dataview 等其它插件的语法，效果取决于对应插件是否启用
- 图片/嵌入 `![[...]]` 的相对路径解析以当前文件为基准

## License

MIT
