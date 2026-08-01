# 轻阅笔记（LightReader）

轻阅笔记是一个以本地优先方式管理电子书、阅读进度与阅读笔记的桌面应用。当前 MVP 已支持从系统文件选择器导入 EPUB、提取基础元数据与封面，并将受控文件和书架记录持久化到本地。

## 当前阶段

当前完成了第一条业务切片：EPUB 导入与书架持久化。支持格式目前仅为 EPUB；正文阅读、真实阅读进度及笔记能力仍未实现。请不要在没有新增编号迁移的情况下扩展数据库。

## 技术栈

- TypeScript 6（严格模式）、React 19、React Router 7、Vite 8
- Tauri 2、Rust、SQLite、Tauri SQL 插件
- Zustand、Zod
- Tailwind CSS 4、Radix UI、Lucide React、CVA
- Vitest、React Testing Library、Playwright
- ESLint flat config、Prettier
- pnpm 11

## 环境要求

- Node.js 24 或当前受支持的 LTS 版本
- 通过 Corepack 提供的 pnpm 11
- Rust stable、Cargo 和 rustup
- 对应平台的 Tauri 2 系统依赖
  - macOS：Xcode Command Line Tools（`xcode-select --install`）
  - Windows：Microsoft C++ Build Tools 与 WebView2
  - Linux：WebKitGTK 及发行版对应的编译依赖

可用以下命令快速检查主要工具：

```bash
node --version
pnpm --version
rustc --version
cargo --version
```

## 安装

```bash
corepack enable pnpm
pnpm install
```

## 开发

启动 Web 开发模式：

```bash
pnpm dev
```

启动 Tauri 桌面开发模式：

```bash
pnpm tauri:dev
```

也可以使用等价命令 `pnpm tauri dev`。

## 质量检查

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:run
```

首次运行 E2E 前安装 Chromium：

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

当前 Playwright 用例运行在 Vite Web 页面上，覆盖启动、导航、主题、预置书架和 mock 导入交互。Web 模式使用确定性的 mock importer；真实系统文件选择、受控文件复制和 SQLite 持久化只在 Tauri 运行时启用。未来需要验证 Tauri 原生窗口时，可在独立任务中接入平台 WebDriver，不要把原生驱动和浏览器用例混在同一配置中。

仅运行 EPUB 导入相关单元和 UI 测试：

```bash
pnpm exec vitest run src/features/library src/storage src/database
```

## 构建

构建 Web 资源：

```bash
pnpm build
```

构建桌面安装包：

```bash
pnpm tauri:build
```

## 数据库健康检查

在 `pnpm tauri:dev` 打开的设置页中，开发环境会显示“检查数据库”按钮。它通过封装后的数据库客户端打开 `sqlite:light-reader.db`，写入并读回 `app_meta`。普通浏览器没有 Tauri SQL 运行时，因此 Web 开发模式下执行该按钮会报告失败，这是预期行为。

## 目录

```text
src/
├── app/                  # 路由、Provider、桌面布局
├── components/           # 通用组件与基础 UI
├── database/             # SQL 客户端、Book Repository 与记录映射
├── features/             # 按业务能力组织的功能模块
├── reader-engines/       # 阅读引擎抽象
├── storage/              # 存储抽象和受控 EPUB 文件存储
├── stores/               # 仅存放跨页面 UI 状态
├── styles/               # 全局主题与 Tailwind 入口
└── test/                 # 测试环境配置
src-tauri/                # Rust 应用、插件注册、权限与迁移
tests/e2e/                # Vite Web E2E
docs/                     # 后续架构文档
```

React 组件不能直接调用 Tauri API。文件与平台能力通过 Adapter/Service 隔离，持久化业务数据通过 Repository 隔离；这让 Web 测试和未来实现替换保持可控。

EPUB 导入的依赖边界、回滚策略和路径约束见 [`docs/epub-import.md`](docs/epub-import.md)。

## EPUB 数据与文件位置

- SQLite 数据库：Tauri 应用配置目录中的 `light-reader.db`；迁移 `0002_create_books.sql` 创建 `books` 表。
- EPUB：Tauri `AppData/light-reader/books/<book-id>/book.epub`。
- 封面：Tauri `AppData/light-reader/covers/<book-id>.<ext>`；无可用封面时显示内置默认封面。
- 临时导入：Tauri `AppData/light-reader/tmp/<book-id>/`，成功或失败后清理。

数据库只保存元数据、SHA-256 哈希和应用生成的相对路径，不保存 EPUB/封面 BLOB，也不把原始外部绝对路径作为长期依赖。不同操作系统的 AppData 绝对位置由 Tauri 决定。

## 当前未实现

- EPUB 阅读与 EPUB 阅读引擎
- PDF 阅读
- 真实阅读进度
- 高亮
- 批注
- 笔记编辑器
- 云同步
- Foliate JS、PDF.js 与 Tiptap 依赖

## 常见问题

### `pnpm` 不存在

运行 `corepack enable pnpm`。如果 Node 安装目录不可写，请使用该 Node 发行方式推荐的权限配置，不要用来源不明的脚本或关闭系统保护。

### Tauri 无法编译

先确认 `rustc`、`cargo` 和平台编译工具存在。macOS 可运行 `xcode-select -p`；若没有结果，运行 `xcode-select --install`。

### 浏览器中数据库检查失败

这是预期行为。`@tauri-apps/plugin-sql` 需要 Tauri 原生运行时，请改用 `pnpm tauri:dev`。

### Playwright 找不到浏览器

运行 `pnpm exec playwright install chromium` 后重试 `pnpm test:e2e`。

### 数据库在哪里

SQL 插件将 `light-reader.db` 放在应用配置目录中。它是本地运行时数据，已被 Git 忽略，不应提交到仓库。

### 为什么浏览器模式不会打开系统文件选择器

浏览器 E2E 使用 mock adapter 验证书架交互，避免依赖原生对话框。请使用 `pnpm tauri:dev` 验证真实 EPUB 导入。
