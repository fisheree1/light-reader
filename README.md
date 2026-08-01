# 轻阅笔记（LightReader）

轻阅笔记是一个计划以本地优先方式管理电子书、阅读进度与阅读笔记的桌面应用。本仓库当前只包含可运行的工程骨架，用于验证 React/Vite 前端、Tauri 2 原生壳、基础导航、主题和 SQLite 插件链路。

## 当前阶段

当前为基础设施阶段：业务页面仅是路由占位内容，数据库仅有 `app_meta` 健康检查表。请不要把当前界面视为产品设计稿，也不要在没有迁移的情况下扩展数据库。

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

当前 Playwright 用例运行在 Vite Web 页面上，覆盖启动、导航和主题切换。未来需要验证 Tauri 原生窗口时，可在独立任务中接入平台 WebDriver（例如 macOS/Linux 上的 `tauri-driver` 方案），不要把原生驱动和浏览器用例混在同一配置中。

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
├── database/             # SQL 客户端、Repository 边界与未来 Schema
├── features/             # 按业务能力组织的功能模块
├── reader-engines/       # 阅读引擎抽象
├── storage/              # 平台无关存储抽象
├── stores/               # 仅存放跨页面 UI 状态
├── styles/               # 全局主题与 Tailwind 入口
└── test/                 # 测试环境配置
src-tauri/                # Rust 应用、插件注册、权限与迁移
tests/e2e/                # Vite Web E2E
docs/                     # 后续架构文档
```

React 组件不能直接调用 Tauri API。文件与平台能力通过 Adapter/Service 隔离，持久化业务数据通过 Repository 隔离；这让 Web 测试和未来实现替换保持可控。

## 当前未实现

- EPUB 阅读与 EPUB 阅读引擎
- PDF 阅读
- 高亮
- 批注
- 笔记编辑器
- 正式数据库 Schema 与业务 Repository
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
