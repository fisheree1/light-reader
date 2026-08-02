# 轻阅笔记（LightReader）

轻阅笔记是一个以本地优先方式管理电子书、阅读进度与阅读笔记的桌面应用。当前 MVP 已支持 EPUB 导入、可搜索与排序的持久化书架、收藏与标签、版本化本地备份与恢复，并可使用 Foliate JS 阅读正文、调整主题与排版、恢复上次阅读位置、创建持久化高亮和文字批注、用 Tiptap 编写带原文引用的独立笔记，以及在本机搜索笔记、高亮和 EPUB 正文。

## 当前阶段

当前完成了 EPUB 导入、书架持久化和管理、基础阅读、高亮、轻量文字批注、独立笔记、本地全文搜索和数据库备份恢复闭环。书架可按书名、作者或标签搜索，按最近阅读、添加时间或标题排序，并支持收藏、标签和两种安全删除模式。支持格式目前仅为 EPUB；阅读设置、位置、高亮、批注、版本化 Tiptap JSON 笔记和派生搜索索引均持久化到本地 SQLite，并可导出为 `.lightreader-backup` 后在兼容版本中恢复。

## 技术栈

- TypeScript 6（严格模式）、React 19、React Router 7、Vite 8
- Tauri 2、Rust、SQLite FTS5、Tauri SQL 插件
- Tauri single-instance 插件（桌面进程级数据目录互斥）
- Foliate JS（固定官方 Git 提交）
- Tiptap 3（StarterKit、Markdown、Placeholder、自定义 BookQuoteNode）
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

当前 Playwright 用例运行在 Vite Web 页面上，覆盖启动、导航、主题、预置书架、mock 导入、书架收藏/标签/排序/受保护删除、本地搜索，以及一条通过真实 Foliate JS 完成排版、位置、高亮、批注、Tiptap 引用、刷新恢复和搜索的发布闭环。Foliate 内容帧相关用例串行运行，以避免本地或受限 CI 主机冷启动模块图时的不稳定竞争。Web 模式使用确定性的 mock importer、localStorage Repository 与无版权 EPUB；真实系统文件选择、受控文件读取、SQLite FTS5 和原生备份恢复只在 Tauri 运行时启用，并与 Web 结果分开报告。

仅运行 EPUB 导入相关单元和 UI 测试：

```bash
pnpm exec vitest run src/features/library src/storage src/database
```

仅运行本地搜索相关测试：

```bash
pnpm exec vitest run src/features/search src/database/repositories/sqlite-search-repository.test.ts src/database/schema/search-record.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --test books_migration local_search_indexes_chinese_english_large_text_and_rebuilds
```

仅运行书架管理相关测试：

```bash
pnpm exec vitest run src/features/library src/storage/book-paths.test.ts src/database/repositories/sqlite-library-repository.test.ts src/features/notes/domain/note.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --test books_migration library_metadata_persists_sorts_and_follows_book_lifecycle
```

仅运行备份相关测试：

```bash
pnpm exec vitest run src/features/backup src/features/settings/settings-page.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml backup::tests
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
├── database/             # SQL 客户端、业务 Repository 与搜索索引映射
├── features/             # 按业务能力组织的功能模块
├── reader-engines/       # 阅读引擎抽象与 Foliate adapter
├── storage/              # 存储抽象和受控 EPUB 文件存储
├── stores/               # 仅存放跨页面 UI 状态
├── styles/               # 全局主题与 Tailwind 入口
└── test/                 # 测试环境配置
src-tauri/                # Rust 应用、插件注册、权限与迁移
tests/e2e/                # Vite Web E2E
docs/                     # 后续架构文档
```

React 组件不能直接调用 Tauri API。文件与平台能力通过 Adapter/Service 隔离，持久化业务数据通过 Repository 隔离；这让 Web 测试和未来实现替换保持可控。

EPUB 导入的依赖边界、回滚策略和路径约束见 [`docs/epub-import.md`](docs/epub-import.md)。书架管理、删除事务和引用保护见 [`docs/library-management.md`](docs/library-management.md)。数据库快照、备份格式与恢复事务见 [`docs/data-backup.md`](docs/data-backup.md)。阅读器生命周期、定位模型和内容安全策略见 [`docs/reader-engine.md`](docs/reader-engine.md)。笔记文档、自动保存和引用块约定见 [`docs/notes-editor.md`](docs/notes-editor.md)。FTS5 表、章节抽取和索引重建策略见 [`docs/local-search.md`](docs/local-search.md)。

## EPUB 数据与文件位置

- SQLite 数据库：Tauri 应用配置目录中的 `light-reader.db`；`0002` 创建图书，`0003` 创建阅读设置和位置，`0004` 创建高亮，`0005` 为同一 annotations 表增加批注文本，`0006` 创建独立 notes 表，`0007` 创建本地 FTS5 搜索索引，`0008` 增加收藏字段和 `book_tags`。
- EPUB：Tauri `AppData/light-reader/books/<book-id>/book.epub`。
- 封面：Tauri `AppData/light-reader/covers/<book-id>.<ext>`；无可用封面时显示内置默认封面。
- 临时导入：Tauri `AppData/light-reader/tmp/<book-id>/`，成功或失败后清理。
- 删除隔离区：Tauri `AppData/light-reader/trash/<deletion-id>/`；文件先移入隔离区，数据库提交后再清理，以便数据库失败时恢复。
- 迁移安全快照：Tauri `AppData/light-reader/migration-snapshots/`；升级前使用 `VACUUM INTO` 创建并校验，最多保留三个。

数据库只保存元数据、SHA-256 哈希和应用生成的相对路径，不保存 EPUB/封面 BLOB，也不把原始外部绝对路径作为长期依赖。不同操作系统的 AppData 绝对位置由 Tauri 决定。

## 本地搜索

主导航的“搜索”页面支持笔记标题与正文、高亮原文，以及 EPUB 章节正文。所有查询都在当前设备完成：Tauri 使用 SQLite FTS5 trigram 索引，少于三个字符的查询安全回退到 SQLite `LIKE`；Web 测试模式使用 localStorage Repository。首次搜索会为尚未索引的 EPUB 延迟抽取 spine 章节纯文本，也可以手动点击“重建索引”。索引是可重建派生数据，不包含 DOM、页码、外部绝对路径或 EPUB 文件 BLOB。

## 书架管理

书架页支持书名、作者与标签搜索、收藏筛选，以及最近阅读、添加时间和标题排序。管理对话框可维护每本书的标签。删除前必须先选择影响范围，再进行第二次明确确认：

- “删除书籍和所有数据”删除 EPUB、封面及随书级联的阅读位置、高亮、批注、正文索引、收藏和标签；独立笔记保留，但其中指向该书的引用块会在同一个数据库事务中移除，其他笔记正文不受影响。
- “删除文件但保留笔记引用”删除书籍和随书数据，同时保留独立笔记中的引用快照。书籍不存在后，该快照不能再跳回原文。

Tauri 文件删除采用应用受控隔离区：先原子重命名 EPUB 目录和封面，再执行 SQLite 事务；事务失败会把文件移回原位置，事务成功后才移除隔离文件。任何目标路径都必须匹配应用生成的 `light-reader/books/<id>` 和 `light-reader/covers/<id>.<ext>`，不会删除用户提供的任意路径。

## 数据备份与恢复

设置页可以把书籍元数据、收藏和标签、阅读设置与进度、高亮、批注、笔记以及本地搜索索引导出为一个 `.lightreader-backup` 文件。备份只在 Tauri 桌面环境可用，完全本地执行，不调用外部 API。

导出使用 SQLite `VACUUM INTO` 生成一致性快照，不直接复制正在运行的 `light-reader.db`。导入会先检查固定归档结构、文件大小、SQLite 文件头、SHA-256、备份格式版本、数据库 Schema 版本、完整性、记录计数，以及每本书的受控 EPUB/封面路径与本机文件状态，验证完成后才显示“确认恢复”。恢复在单个 SQLite 事务中替换规范数据；约束、计数或写入失败会回滚，保留恢复前数据。

备份不包含 EPUB 和封面二进制文件。因此它是当前设备的数据备份，不是跨设备书籍包；若备份引用的受控文件缺失、大小变化或路径不安全，预检会拒绝恢复，避免生成无法打开的书架记录。格式和安全边界详见 [`docs/data-backup.md`](docs/data-backup.md)。

## EPUB 基础阅读

在书架点击书籍即可进入 `/reader/:bookId`。当前阅读页支持：

- 打开应用受控目录中的 EPUB；
- 嵌套目录展示与章节跳转；
- 按钮及左右方向键翻页；
- CFI、章节 href 和 0～1 总进度组成的版本化 locator；
- 明亮、羊皮纸和深色正文主题；
- 字号、行高、正文宽度和页边距设置；
- 设置页的全局阅读偏好，以及阅读页的单书覆盖；
- 阅读位置防抖写入 SQLite，并在再次打开图书时恢复；
- 选择正文后使用黄色、蓝色、绿色或红色高亮；
- 保存原文、前后文、章节 href 和版本化 CFI，不保存 DOM selector 或页码；
- 通过右侧栏定位高亮，失效 locator 会保留数据并标记“无法定位原文”；
- 点击高亮添加、编辑、自动保存或删除轻量文字批注；
- 从高亮创建带原文、书籍、章节和 CFI 快照的独立笔记；
- 加载、文件缺失、损坏 EPUB 和导航错误状态；
- 离开页面时卸载章节、撤销资源并销毁 Foliate renderer。

独立笔记除串行 SQLite 自动保存外，还会同步写入带数据库基线版本的本地草稿日志。若应用在防抖保存前异常退出，下次启动会恢复草稿；数据库已更新时，旧草稿不会反向覆盖新内容。

## 当前未实现

- PDF 阅读
- 书签
- 跨设备协作编辑
- 独立笔记和批注的通用格式导出
- AI 总结
- 云同步
- PDF.js

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

### 备份是否包含 EPUB 文件

不包含。`.lightreader-backup` 保存数据库内容，包括书籍元数据、阅读数据、高亮、批注和笔记；EPUB 与封面仍保存在应用受控目录。恢复前会验证这些文件仍存在且大小匹配，否则安全拒绝。当前格式不能单独完成跨设备书籍迁移。

### 为什么 Foliate JS 使用 Git 提交而不是版本号

Foliate JS 目前没有稳定发布。项目将官方仓库固定在提交 `78914aef4466eb960965702401634c2cb348e9b1`，升级时必须单独审查 API、内容安全和测试结果。
