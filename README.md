# 轻阅笔记（LightReader）

轻阅笔记是一款本地优先的桌面阅读与笔记应用。它支持 EPUB、PDF、书架管理、阅读进度、高亮批注、独立笔记、本地全文搜索、书签、导出、完整备份，以及由本机 Ollama 驱动的可选 AI 阅读助手。

所有核心阅读功能无需账号和云服务。书籍、笔记与索引默认保存在本机；AI 默认关闭，启用后也只连接固定的本机 Ollama 地址。

## 主要能力

- 导入和阅读 EPUB、PDF，支持目录、位置恢复、排版设置与触控操作。
- 管理收藏、标签、最近阅读、书签、高亮和文字批注。
- 使用 Tiptap 编写带原文引用的独立笔记。
- 在本机搜索笔记、高亮、EPUB 正文和 AI 单书索引。
- 导出笔记与批注；创建仅数据库或包含书籍、封面的完整备份。
- 使用本机模型总结、解释、翻译选区，或基于当前书籍进行带引用问答。

## 技术栈

- React 19、TypeScript 6、React Router 7、Vite 8
- Tauri 2、Rust、SQLite FTS5
- Foliate JS（EPUB）、PDF.js、Tiptap 3
- Zustand、Zod、Tailwind CSS 4、Radix UI、Lucide React
- Vitest、React Testing Library、Playwright
- ESLint、Prettier、pnpm 11

## 环境要求

- Node.js 24 或当前受支持的 LTS 版本
- pnpm 11（通过 Corepack 提供）
- Rust stable、Cargo 和 rustup
- 对应平台的 Tauri 2 系统依赖
  - macOS：Xcode Command Line Tools
  - Windows：Microsoft C++ Build Tools 与 WebView2
  - Linux：WebKitGTK 及发行版对应的编译依赖
- 可选：Ollama 与 `deepseek-r1:8b`，仅在使用本地 AI 时需要

## 安装与运行

```bash
corepack enable pnpm
pnpm install
pnpm tauri:dev
```

`pnpm tauri:dev` 会启动完整桌面应用，支持真实文件选择、SQLite、备份和 Ollama。`pnpm dev` 仅启动适合界面开发和 Web 测试的浏览器版本，其中原生能力会被替代或禁用。

首次使用时：

1. 在“书架”导入 EPUB 或 PDF。
2. 点击封面开始阅读，并在阅读页使用目录、搜索、高亮、书签和 AI 侧栏。
3. 在“笔记”管理独立笔记，在“搜索”检索本机内容。
4. 在“设置”调整阅读偏好、配置本地 AI，并定期创建完整备份。

## 本地 AI（可选）

```bash
ollama pull deepseek-r1:8b
ollama serve
```

随后在“设置 → 本地 AI 助手”中启用并检测连接。阅读页 AI 侧栏支持自由输入需求、处理当前选区和本书问答。模型只能接收用户确认的文本或受限检索结果，不能直接访问 SQL、Repository、文件路径或原始笔记；结果先生成独立草稿，不会覆盖用户内容。

## 开发与验证

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:run
pnpm test:coverage
pnpm test:e2e
pnpm bundle:check
```

首次运行端到端测试前执行 `pnpm exec playwright install chromium`。桌面安装包使用 `pnpm tauri:build` 构建。CI、覆盖率基线、原生测试范围和专项测试命令见[测试与交付文档](docs/testing.md)，跨平台打包与真实桌面验收见[发布清单](docs/release.md)。

## 项目结构

```text
src/
├── app/                  # 路由、Provider 与桌面布局
├── components/           # 通用组件与基础 UI
├── database/             # SQL 客户端、Repository 与索引映射
├── features/             # 按业务能力组织的功能模块
├── reader-engines/       # EPUB/PDF 阅读引擎适配器
├── storage/              # 受控文件存储边界
├── stores/               # 跨页面 UI 状态
└── test/                 # 测试环境配置
src-tauri/                # Rust 应用、插件、权限、迁移与原生测试
tests/e2e/                # Playwright 端到端测试
docs/                     # 功能、架构、评估与 ADR 文档
```

React 组件不直接调用 Tauri API。平台能力通过 Adapter/Service 隔离，持久化业务数据通过 Repository 隔离。SQLite 只保存受控相对路径和元数据，不保存书籍文件 BLOB，也不长期依赖导入源的绝对路径。

## 文档

完整文档地图和每份文档的职责见 [`docs/README.md`](docs/README.md)。常用入口：

- [EPUB/PDF 阅读引擎](docs/reader-engine.md)
- [导入与受控文件存储](docs/book-import.md)
- [书架管理与安全删除](docs/library-management.md)
- [笔记编辑器](docs/notes-editor.md)
- [本地搜索与 AI 索引](docs/local-search.md)
- [备份与恢复](docs/data-backup.md)
- [导出格式](docs/export-formats.md)
- [AI Agent 开发设计](docs/ai-agent-development.md)
- [云同步评估](docs/cloud-sync-evaluation.md)
- [测试与交付](docs/testing.md)
- [跨平台发布清单](docs/release.md)

## 尚未实现

- 云同步与跨设备协作编辑
- 语义向量检索、跨书研究 Agent 和长期学习工作流
