# 安装与使用指南

## 快速开始

### 1. 安装插件

将构建好的插件复制到你的 Obsidian vault：

```bash
# 方式 A：直接复制（推荐）
cp -r /mnt/d/project/my\ free\ mindmap /path/to/your-vault/.obsidian/plugins/full-content-mindmap

# 方式 B：在 vault 的插件目录下克隆并构建
cd /path/to/your-vault/.obsidian/plugins/
git clone <repo> full-content-mindmap
cd full-content-mindmap
npm install
npm run build
```

### 2. 启用插件

1. 打开 Obsidian → 设置 → 第三方插件
2. 关闭「安全模式」（如果还没关）
3. 点击「已安装插件」，找到「Full Content MindMap」
4. 打开开关启用

### 3. 打开思维导图

两种方式：

**方式 A（推荐）**：命令面板
- 按 `Ctrl/Cmd + P` 打开命令面板
- 输入「打开思维导图」或「mindmap」
- 回车

**方式 B**：编辑代码添加侧边栏图标（可选）
- 右侧会出现思维导图面板

### 4. 使用

- **查看思维导图**：打开任意 markdown 文件，思维导图自动渲染
- **展开内容**：点击节点上的「展开」按钮查看完整内容
- **折叠内容**：点击「折叠」按钮恢复摘要
- **跳转源文件**：直接点击节点可跳转到对应位置
- **适应窗口**：点击工具栏「适应窗口」按钮
- **手动刷新**：点击「刷新」按钮重新渲染

## 测试文件示例

在 vault 中创建一个测试文件 `test-mindmap.md`：

\`\`\`markdown
# 这是主标题

这是一个段落，用来测试段落内容的渲染。如果段落超过 80 字，会显示摘要和展开按钮。这里继续写一些内容来达到长度限制，看看截断效果如何。

## 二级标题

- 列表项 1
- 列表项 2
  - 嵌套列表项
- 列表项 3

### 代码示例

\`\`\`javascript
function hello() {
  console.log("Hello World");
  return 42;
}
\`\`\`

### 表格示例

| 列1 | 列2 | 列3 |
|-----|-----|-----|
| A   | B   | C   |
| D   | E   | F   |

### 引用

> 这是一段引用内容
> 可以多行

## 任务列表

- [x] 已完成任务
- [ ] 未完成任务

## 图片

![示例图片](https://via.placeholder.com/150)
\`\`\`

打开这个文件，执行「打开思维导图」命令，你会看到所有内容都被渲染成思维导图。

## 开发模式

如果要实时开发：

```bash
cd /mnt/d/project/my\ free\ mindmap
npm run dev
```

修改源码后会自动重新构建。在 Obsidian 中按 `Ctrl/Cmd + R` 重新加载插件即可看到变化。

## 故障排查

**问题：插件列表中找不到**
- 检查路径：确保插件在 `<vault>/.obsidian/plugins/full-content-mindmap/` 下
- 确认文件：必须包含 `main.js` 和 `manifest.json`

**问题：思维导图不显示**
- 确保当前文件是 markdown 格式（`.md`）
- 打开控制台（`Ctrl/Cmd + Shift + I`）查看错误信息

**问题：内容显示不全**
- 这是 MVP 版本，部分富内容（代码高亮、数学公式）会在后续版本支持
- 当前版本重点保证「结构完整」，所有块都会显示
