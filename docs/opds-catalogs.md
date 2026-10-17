# OPDS 书库

更新日期：2026-10-17。`/discover` 的“OPDS 书库”标签页可以浏览和搜索 OPDS 1.x 目录，并把其中的电子书下载到书架。它适用于自建书库（Calibre-Web、Kavita、Komga 等）和公版书目录（内置一键添加 Project Gutenberg）。这一功能仅在桌面版可用。

## 范围

- **支持：** OPDS 1.x Atom 目录，包括导航条目、分页（`next`/`previous`）和 `start`。搜索可以使用 OpenSearch 描述文档（每个会话只获取一次），也可以使用直接带 `{searchTerms}` 的链接；其他 OpenSearch 参数会被去掉。
- **下载：** 只使用免费的 acquisition（`acquisition`、`open-access` 等）；`buy`、`borrow`、`subscribe`、`sample` 会被忽略。格式按 EPUB、AZW3、MOBI、FB2、PDF、CBZ 的顺序优先选择，下载后经由现有的 `importBytes` 入库，复用格式校验、去重和失败补偿。
- **暂不支持：** OPDS 2.0（JSON）、需要登录的书库（HTTP 401 会提示“需要登录”），以及间接获取（indirect acquisition）。
- **书库列表**是偏好设置，和主题一样保存在 `localStorage`（`light-reader-opds`），不进入备份。读取时会重新校验，损坏的数据会被丢弃。

## 原生请求与地址限制

请求由 `src-tauri/src/opds.rs` 的 `opds_read_feed`、`opds_download` 和 `opds_cancel` 完成，只接受主窗口调用。

- **用户添加的书库：** 对它的同源请求（相同的协议、主机和端口）可以访问局域网地址，以支持自建书库。
- **目录中指向其他来源的链接：** 视为不可信，必须是 HTTPS，并且 DNS 解析结果全部是公网地址；连接会固定到这些地址。
- **其他限制：** 地址中不得包含用户名或密码；只允许 http(s)；重定向最多 5 次，每一跳都重新检查。
- **大小与时间：** 目录最大 5 MiB，封面最大 5 MiB，书籍最大 200 MiB。连接超时 10 秒，读取停顿超时 30 秒。目录和封面每次最多 45 秒，书籍最多 15 分钟。同时最多处理 4 个请求，取消会中止原生请求。
- **错误映射：** 401 映射为 `OPDS_AUTH_REQUIRED`，403 和 429 沿用书源拒绝与限流错误，404/410 映射为 `OPDS_NOT_FOUND`。目录响应如果是 HTML（通常是登录页），会映射为 `OPDS_NOT_FEED`。

封面在前端排队，逐个加载。

## 测试

- **前端测试：** `FixtureOpdsGateway`（`src/test/fixtures/opds-gateway.ts`）提供原创的目录、分页、OpenSearch 和 EPUB 夹具，覆盖解析、服务、书库列表、面板以及 Playwright 的入库流程。
- **Rust 测试：** 覆盖同源与跨源判定、非公网地址拒绝、状态码映射和 HTML 目录拒绝。
