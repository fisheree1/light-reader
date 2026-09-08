# LightReader AI Agent 开发设计

状态：Phase A/B 已实现本地 Ollama 选中文本助手；Phase C～F 尚未实现。

更新日期：2026-09-08。

当前实现采用固定回环地址的 Ollama Provider，默认模型为
`deepseek-r1:8b`。领域 schema、授权状态机、预算、Fake Provider、敏感内容
提示、精确文本确认、流式取消、内存 AI 草稿、设置页和确认后新建笔记已经
接入。实现决策见 [`adr/0001-local-ollama-provider.md`](adr/0001-local-ollama-provider.md)，
模型基线见 [`ai-local-model-baseline.md`](ai-local-model-baseline.md)。单书 RAG、
引用、工具型 Agent、受控追加和高级能力仍按本文后续阶段实施。

本文定义 LightReader 后续引入 AI Agent 能力时的产品范围、架构边界、
数据模型、工具协议、RAG、隐私、安全、测试和交付顺序。它建立在现有
本地优先阅读、稳定 locator、Repository、Tauri 平台隔离和 Tiptap 笔记
模型之上。

本文不授权安装 AI SDK、增加网络权限、创建数据库迁移、选择具体模型，
也不改变 [`cloud-sync-ai-evaluation.md`](cloud-sync-ai-evaluation.md) 中已经
确定的原则：AI 默认关闭、远程发送必须明确授权、用户决定发送范围、
模型输出不得覆盖原始笔记。

## 1. 产品定位

推荐产品定位是“有证据、可跳转、受用户控制的阅读研究 Agent”，不是
没有边界的聊天窗口。

普通 AI 助手完成一次文本生成；Agent 还需要在一个受控循环中选择工具、
读取证据、维护运行状态、请求必要授权、校验结果并停止。Agent 的价值必须
来自对阅读工作流的理解，而不是来自工具数量或 Agent 数量。

### 1.1 目标

- 基于用户明确选择的 EPUB、PDF、批注或笔记回答问题。
- 优先在本地搜索和筛选，只把完成当前任务所需的有限文本交给模型。
- 每条事实性回答尽量附带书籍、章节、原文和版本化 locator。
- 允许用户从引用直接跳回 EPUB CFI 或 PDF 页码/文本范围。
- 支持可取消、可恢复、有限步数的工具调用循环。
- 所有模型输出先进入独立 `AiDraft`，由用户决定复制、新建或追加。
- 用固定数据集、工具轨迹和安全断言持续评估模型或 prompt 变化。
- 保持无账号、无网络、无 AI 时的全部现有阅读功能。

### 1.2 非目标

- 第一阶段不上传整本书或整个书库。
- 第一阶段不提供删除、覆盖笔记、修改批注或任意文件写入工具。
- 不允许模型直接访问 SQL、Tauri、文件路径、API Key 或 Repository。
- 不让模型执行任意 JavaScript、Shell、SQL、URL 请求或下载内容。
- 不在启动、导入、索引、阅读、搜索、保存或备份时隐式调用模型。
- 不用多 Agent、MCP 或通用 Agent 框架替代清晰的应用边界。
- 不实现自主长期目标、后台持续运行或未经确认的跨会话记忆。

## 2. 优先产品能力

### 2.1 P0：选中文本助手

这是最小、安全且容易验证的能力：

- 总结、解释或翻译当前选择；
- 提取人物、概念、论点、问题和关键句；
- 将选择转换为提纲、闪卡候选或阅读问题；
- 根据选择和用户指令生成一个独立草稿；
- 展示准确的发送文本、来源、字符数、供应商和模型；
- 关闭确认框、取消请求或模型失败时不产生任何持久化写入。

P0 不是 Agent 的最终形态，但它先验证 Provider、流式输出、授权、取消、
结果校验和草稿隔离，是后续工具调用的安全基础。

### 2.2 P1：带本地检索的单书问答

- 用户明确选择一本书作为范围。
- 本地解析、切块、关键词召回和语义召回。
- 仅发送排名靠前的有限段落。
- 回答附带可验证引用和 locator。
- 找不到足够证据时明确说“当前书中没有找到支持”。
- 不允许模型自行扩大到其他书籍、笔记或网络。

### 2.3 P2：工具型阅读研究 Agent

在用户批准的运行范围内，单 Agent 可以选择以下只读工具：

- 读取当前选择；
- 搜索选中的书籍；
- 按 locator 读取一段有限上下文；
- 搜索用户允许的笔记或批注；
- 获取书籍目录和元数据；
- 将最终结果保存为独立 AI 草稿。

典型任务是：

> 比较这三本书对“自由意志”的观点，引用原文并生成研究笔记草稿。

Agent 可以分解问题、并发搜索独立书籍、读取证据、去重、比较观点、验证
引用并生成草稿，但不得绕过运行授权或直接修改任何已有笔记。

### 2.4 P3：学习工作流

- 从选定章节生成闪卡候选；
- 生成章节小测验和答案依据；
- 根据错题和阅读进度生成复习清单；
- 将多个高亮整理成主题提纲；
- 根据用户选择的目标生成阅读计划；
- 导出带来源引用的研究报告。

这些输出仍然是候选内容。加入学习库、追加到笔记或创建阅读计划都需要
明确确认。

### 2.5 延后能力

- 多 Agent：只有当同一复杂任务可以稳定拆成独立工作流，并且评估证明
  质量收益大于延迟和成本时再引入。
- MCP：内部工具合约稳定后，可选择把只读书库能力暴露为本地 MCP server，
  或连接用户明确授权的外部知识源。
- 语音：文本 Agent 的状态、授权、工具和评估稳定后再考虑 Realtime。
- 长期记忆：必须独立建模、可查看、可删除、可过期，并由用户逐项授权。
- 整书或全库远程处理：只有独立隐私评审和明确产品需求后才重新评估。

## 3. 与现有能力的衔接

| 现有能力              | Agent 可以复用的部分                           | 仍需补充                                                      |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| `EbookReader`         | `getSelection()`、章节搜索、稳定 `BookLocator` | 面向 Agent 的有限段落读取服务，不能泄露引擎对象               |
| `LocalSearchService`  | FTS5、本地笔记/批注/EPUB 搜索                  | PDF 持久化文本索引、统一 chunk、语义检索和排序融合            |
| `NoteService`         | 创建笔记、串行保存和 Tiptap 文档               | 专用 `AiDraftService`，避免 Agent 获得 `save()` 或 `delete()` |
| `AnnotationService`   | 稳定引用、上下文和跳转                         | 只读查询适配器，第一阶段不暴露更新工具                        |
| `BookRepository`      | 稳定书籍 ID、格式、文件哈希                    | 只通过应用 Service 查询，Agent 不获得 Repository              |
| EPUB/PDF locator      | 引用、跳转和范围限制                           | chunk 到 locator 的双向映射及引用失效状态                     |
| Zod                   | 领域和边界运行时校验                           | Agent request/event/tool/result 的版本化 schema               |
| Tauri Adapter/Service | 密钥、网络和本地模型可以隔离到平台层           | Provider Gateway、凭据存储、流式事件和取消通道                |
| Vitest/Playwright     | 单元、组件、流程和无障碍测试                   | 模型 fake、轨迹回放、eval 数据集和 Agent 安全断言             |

现有 `ReaderTextSelection` 已包含文本、前后文和版本化 locator，适合作为
选择型 AI 的输入起点。现有本地搜索已经能返回笔记、批注和 EPUB 章节结果，
但 Agent 不能直接消费展示用 excerpt 作为完整证据；RAG 层需要稳定的 chunk、
长度预算、来源哈希和 locator 映射。

## 4. 推荐架构

```text
Reader / Notes UI
  -> AgentFacade
      -> AgentConsentService
      -> AgentRunner
          -> AgentScopePolicy
          -> AgentToolRegistry
              -> ReaderContextService
              -> AgentSearchService
              -> NoteQueryService
              -> AnnotationQueryService
              -> AiDraftService
          -> RetrievalService
              -> KeywordRetriever (SQLite FTS5)
              -> VectorRetriever (derived local index)
              -> ResultFusion / optional Reranker
          -> ModelProviderGateway
      -> AgentRunTelemetry

Canonical user data
  -> existing domain Services
      -> existing Repositories

Agent-owned data
  -> AiDraftRepository / AgentRunRepository
      -> SQLite or Web test implementation
```

### 4.1 强制边界

1. React 组件只调用 `AgentFacade`，不调用供应商 SDK、Tauri 或 SQL。
2. `AgentRunner` 只看到版本化工具合约，不持有领域 Repository。
3. 工具实现调用现有应用 Service 或专用只读查询 Service。
4. `ModelProviderGateway` 只负责模型协议，不决定领域权限。
5. `AgentScopePolicy` 在每次工具执行前做确定性授权检查；模型的解释不能
   代替授权。
6. `AiDraftService` 是第一阶段唯一允许的持久化输出路径。
7. 模型不可见真实文件路径、数据库结构、凭据和平台句柄。
8. 本地搜索索引、向量索引和 rerank 缓存都是可重建派生数据。

### 4.2 建议目录

```text
src/features/ai-agent/
├── domain/
│   ├── agent-run.ts
│   ├── agent-scope.ts
│   ├── agent-tool.ts
│   ├── agent-citation.ts
│   └── ai-draft.ts
├── services/
│   ├── agent-facade.ts
│   ├── agent-consent-service.ts
│   ├── agent-runner.ts
│   ├── agent-scope-policy.ts
│   └── ai-draft-service.ts
├── tools/
│   ├── agent-tool-registry.ts
│   ├── reader-tools.ts
│   ├── search-tools.ts
│   └── draft-tools.ts
├── retrieval/
│   ├── book-text-extractor.ts
│   ├── chunker.ts
│   ├── hybrid-retriever.ts
│   └── citation-validator.ts
├── components/
│   ├── agent-panel.tsx
│   ├── agent-consent-dialog.tsx
│   ├── agent-tool-approval-dialog.tsx
│   └── ai-draft-view.tsx
└── hooks/
    └── use-agent-run.ts

src/platform/ai/
├── model-provider-gateway.ts
├── local-model-provider.ts
└── remote-model-provider.ts

src/database/repositories/
├── ai-draft-repository.ts
└── agent-run-repository.ts
```

只有真正需要持久化时才添加 Repository 和新迁移。网络 Provider、本地模型、
凭据存储和向量实现都必须通过独立 ADR 选择，不能因目录已经预留就默认安装。

## 5. Agent 领域模型

以下接口是设计草案，实际实现时应使用 Zod 定义 schema，再从 schema 推导
TypeScript 类型。

### 5.1 运行状态

```ts
type AgentRunStatus =
  | 'preparing-context'
  | 'awaiting-consent'
  | 'running'
  | 'awaiting-tool-approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface AgentRun {
  schemaVersion: 1;
  id: string;
  task: 'selection-assist' | 'book-qa' | 'research' | 'study';
  status: AgentRunStatus;
  provider: string;
  model: string;
  promptVersion: string;
  scopeGrantId: string;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  toolCallCount: number;
  errorCode: string | null;
}
```

推荐状态转换：

```text
preparing-context
  -> awaiting-consent
      -> cancelled
      -> running
          -> awaiting-tool-approval -> running
          -> completed
          -> failed
          -> cancelled
```

只有 `awaiting-consent -> running` 可以发起第一次远程模型请求。取消是终态；
后续重试创建新的 run，并引用原 run ID，不复活旧运行。

### 5.2 运行授权

```ts
interface AgentCapabilityGrant {
  schemaVersion: 1;
  id: string;
  runId: string;
  provider: string;
  model: string;
  remoteProcessingAllowed: boolean;
  allowedTools: AgentToolName[];
  allowedBookIds: string[];
  allowedNoteIds: string[];
  allowedAnnotationIds: string[];
  maxCharsPerToolResult: number;
  maxTotalContextChars: number;
  maxToolCalls: number;
  expiresAt: number;
  approvedAt: number;
}
```

授权是一次运行的不可变快照。Agent 不能在运行中自行增加书籍、笔记、工具、
文本预算或有效期。需要扩大范围时停止当前运行并重新展示授权界面。

### 5.3 引用

```ts
interface AgentCitation {
  schemaVersion: 1;
  id: string;
  runId: string;
  bookId: string;
  bookTitleSnapshot: string;
  chapterTitleSnapshot: string | null;
  locator: BookLocator;
  quote: string;
  sourceChunkId: string;
  sourceTextHash: string;
  validation: 'verified' | 'stale' | 'unresolved';
}
```

`verified` 表示 quote、chunk 哈希和当前本地文件仍能对应；`stale` 表示书籍
内容已变化但保留可读快照；`unresolved` 表示 locator 无法重新定位。模型不能
自行宣称引用已验证，状态必须由本地 `CitationValidator` 产生。

### 5.4 AI 草稿

```ts
interface AiDraft {
  schemaVersion: 1;
  id: string;
  runId: string;
  task: AgentRun['task'];
  title: string;
  content: string;
  citations: AgentCitation[];
  sourceSnapshotHash: string;
  provider: string;
  model: string;
  promptVersion: string;
  status: 'draft' | 'accepted' | 'discarded';
  createdAt: number;
  decidedAt: number | null;
}
```

`AiDraft` 不是 `NoteSaveInput`。Agent 不获得 `NoteService.save()`。UI 只能：

- 复制草稿；
- 使用普通 `NoteService` 创建一篇新笔记；
- 在用户确认后通过编辑器事务追加到指定笔记；
- 丢弃草稿。

第一阶段不提供 Replace。追加时保留所有原始 Tiptap 节点，并将引用转换为
可读快照或现有 `BookQuoteNode`。

### 5.5 运行记录和隐私

默认持久化的 `AgentRun` 只包含模型、状态、耗时、token、工具名称、错误码
和内容哈希，不保存 prompt、原文、笔记内容、完整工具结果或模型思维过程。

开发诊断可以在测试数据或用户显式开启时记录脱敏轨迹，并设置短期自动删除。
真实私有书籍不得进入提交到仓库的 eval fixture、CI artifact 或第三方 trace。

## 6. 工具系统

### 6.1 工具分级

| 级别           | 行为                           | 默认规则                     |
| -------------- | ------------------------------ | ---------------------------- |
| `read-bounded` | 读取授权范围内的有限文本       | 可以在一次运行授权内执行     |
| `draft-write`  | 创建独立 AI 草稿               | 可以执行，但不能修改用户原文 |
| `user-write`   | 新建笔记或追加内容             | 每次调用前单独确认           |
| `destructive`  | 删除、覆盖、移动文件或恢复备份 | 不向 Agent 暴露              |
| `external`     | 网络搜索、外部连接器或 MCP     | 第一阶段禁用；以后逐项授权   |

工具 schema 限制语法，`AgentScopePolicy` 限制语义和权限。两者都必须通过才
执行。不要相信模型提供的 `bookId`、limit、locator、字符数或操作理由。

### 6.2 第一批工具

#### `get_current_selection`

- 输入：无。
- 输出：当前授权选择的书籍 ID、文本、前后文、locator 和来源标签。
- 限制：选择改变后旧 grant 失效；结果受字符预算约束。

#### `search_books`

- 输入：查询、授权 book IDs、结果数量。
- 输出：有限数量的 `RetrievedPassage`，每项带 locator 和本地相关性分数。
- 限制：executor 将 IDs 与 grant 取交集，并强制 clamp limit。

#### `read_passage`

- 输入：一个已由搜索返回或用户选择的 locator、前后文范围。
- 输出：有限原文、章节、哈希和 locator。
- 限制：不接受文件路径，不读取 locator 所在范围以外的大章节。

#### `search_notes`

- 输入：查询、授权 note IDs、结果数量。
- 输出：标题、有限 excerpt、note ID 和更新时间。
- 限制：需要用户在授权界面明确包含笔记；默认不包含。

#### `search_annotations`

- 输入：查询、授权 book/annotation IDs、结果数量。
- 输出：高亮原文、有限批注、章节和 locator。
- 限制：只读，不能改颜色、批注或删除高亮。

#### `create_ai_draft`

- 输入：结构化标题、正文和 citation IDs。
- 输出：新草稿 ID。
- 限制：citation 必须来自当前 run 且已通过本地验证；正文和标题有大小限制。

### 6.3 工具结果

```ts
type AgentToolResult<T> =
  | {
      ok: true;
      data: T;
      truncated: boolean;
      returnedChars: number;
    }
  | {
      ok: false;
      code:
        | 'OUT_OF_SCOPE'
        | 'NOT_FOUND'
        | 'INVALID_LOCATOR'
        | 'BUDGET_EXCEEDED'
        | 'APPROVAL_REQUIRED'
        | 'UNAVAILABLE';
      message: string;
      retryable: boolean;
    };
```

错误返回稳定 code，不能把 SQL、绝对路径、堆栈或用户正文拼进错误信息。
AgentRunner 对同一失败调用最多重试一次；权限错误不得重试或改写参数绕过。

### 6.4 禁止的通用工具

- `execute_sql`
- `read_file(path)`
- `write_file(path, content)`
- `fetch_url(url)`
- `run_shell(command)`
- `update_note(id, content)`
- `delete_*`
- `restore_backup`

如果未来确有需求，应增加领域语义明确、参数受限、可审计的新工具，而不是
开放通用逃生口。

## 7. RAG 与引用设计

### 7.1 本地索引流程

```text
Managed EPUB/PDF
  -> BookTextExtractor
  -> normalized blocks + locator map
  -> semantic Chunker
  -> text hash / source version
  -> SQLite FTS5 keyword index
  -> optional local embedding index
```

`BookTextExtractor` 按格式适配：

- EPUB 复用现有安全解析思路，保留 chapter href 和 CFI/段落映射；
- PDF 使用 PDF.js 文本层的规范化字符顺序，保留 pageIndex 和 textRange；
- 扫描 PDF 没有文本层时返回明确的 `TEXT_UNAVAILABLE`，第一阶段不隐式 OCR；
- fixed-layout、RTL、嵌套目录和损坏文件沿用现有兼容性与失败隔离规则。

### 7.2 Chunk 模型

```ts
interface BookChunk {
  schemaVersion: 1;
  id: string;
  bookId: string;
  sourceFileHash: string;
  chapterHref: string | null;
  chapterTitle: string | null;
  startLocator: BookLocator;
  endLocator: BookLocator | null;
  text: string;
  textHash: string;
  estimatedTokens: number;
  ordinal: number;
}
```

chunk ID 应从 book ID、文件版本、章节和 ordinal 稳定生成，便于增量重建。
向量、token 计数和排序缓存是派生数据；原文仍以受控书籍文件为准。

### 7.3 切块策略

- 优先在标题、段落、列表或 PDF 页面自然边界切分。
- 对超长段落按句子再切分，避免从 Unicode code point 中间截断。
- 保留小范围 overlap，但相邻结果合并时去重。
- 将目标 chunk 大小和 overlap 作为配置并通过 eval 调整。
- 不把一本书压成一个 prompt，也不把目录、版权页和重复页眉无限加入上下文。
- 引用范围不得超过实际返回给模型的 chunk。

### 7.4 混合检索

第一版使用：

1. SQLite FTS5 召回关键词结果。
2. 可选本地 embedding 召回语义结果。
3. 使用 Reciprocal Rank Fusion 或同类确定性方法合并排名。
4. 合并相邻 chunk，去除重复原文。
5. 可选 reranker 只处理较小候选集。
6. 应用 book scope、字符预算和 top-k 限制。
7. 将最终 passage 和 locator 交给模型。

当前数据规模不要求独立向量数据库。优先评估可嵌入、可重建、跨平台构建稳定
的本地向量方案。是否使用 SQLite 向量扩展、Rust 本地索引或外部本地模型，
必须通过 ADR 比较包体、构建、性能、许可证和迁移成本。

### 7.5 引用验证

模型输出引用的是 citation ID，不直接生成任意 locator。最终渲染前：

1. citation ID 必须属于当前 run。
2. quote 必须来自实际 tool result。
3. source hash 和当前书籍版本匹配时标记 `verified`。
4. locator 必须通过 `bookLocatorSchema`。
5. 能打开书籍时进行一次局部重定位校验。
6. 无法定位时保留快照并明确标记，而不是伪造跳转成功。

回答中的事实性段落如果没有任何证据，应显示“未引用”状态。UI 不应把普通
模型文本装饰成已验证来源。

## 8. AgentRunner

### 8.1 职责

- 建立不可变运行配置和 scope grant。
- 调用 Provider，并把流式事件转换为内部 `AgentEvent`。
- 校验每个 tool call 的名称、参数、授权、预算和审批状态。
- 执行工具并把结构化结果返回 Provider。
- 限制总步数、工具次数、并发、超时、重试和输出大小。
- 接收取消信号并停止模型流与未开始工具。
- 校验最终 structured output、引用和草稿。
- 记录无正文的运行指标和稳定错误码。

### 8.2 Provider 中立接口

```ts
interface ModelProviderGateway {
  readonly capabilities: {
    streaming: boolean;
    structuredOutput: boolean;
    functionTools: boolean;
  };

  run(
    request: AgentModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<AgentProviderEvent>;
}
```

内部事件至少包含：

- `output-delta`
- `tool-call`
- `usage`
- `completed`
- `failed`

Provider 原始事件不能穿过 gateway 进入 React。所有事件先做版本和大小校验。

### 8.3 初始运行预算

以下是第一轮评估的建议默认值，不是不可变协议：

- 每个检索工具最多返回 8 个 passage；
- 每个 passage 最多约 1,500 个字符；
- 一次运行累计传给远程模型的书籍/笔记文本不超过约 12,000 个字符；
- 最多 8 次工具调用；
- 独立只读工具最大并发 3；
- 相同可重试失败最多重试 1 次；
- 默认总超时 60 秒；
- 最终正文默认上限 8,000 个字符；
- 用户取消后不再接受新的 delta 或工具调用。

实际值应根据公开 fixture 的成功率、延迟、成本和截断率调整。任何 Provider
自身上限都只是更外层限制，不能替代应用预算。

## 9. Provider 与凭据方案

### 9.1 推荐顺序

1. `FakeModelProvider`：先完成状态机、授权、工具和测试，不调用模型。
2. 一个 Provider adapter：只实现 P0/P1 所需能力。
3. 本地 Provider：如果包体和设备性能可接受，再加入本地推理。
4. 第二个 Provider：用来证明 gateway 可替换，而不是为了堆叠依赖。

### 9.2 OpenAI 路线

OpenAI 官方 Responses API 当前支持文本/JSON 输出、流式响应、模型工具选择、
自定义函数工具、内置工具和 MCP 工具。LightReader 第一阶段只应映射受控
自定义函数工具，不开启 Web、文件搜索、代码执行或其他 Hosted Tools。

官方 OpenAI 文档建议把 Agents SDK 的 Python/TypeScript 编排逻辑运行在后端。
因此有两种安全形态：

- 应用自有凭据：建立最小 BFF/Agent Service，桌面端只拿短期用户会话，不
  能获取或反编译出供应商 API Key；
- 用户自带 Key：密钥保存在操作系统凭据存储，通过 Tauri 原生 Provider
  调用，永远不进入 React、localStorage、SQLite、日志或备份。

不允许把应用自有 API Key 写进 `.env` 后打包到 Tauri WebView。是否引入
Agents SDK 或直接基于 Responses API 编排，需要在实现前做 ADR；第一版单
Agent 工具循环足够简单时，显式 `AgentRunner` 更容易保持本地边界。

### 9.3 本地模型路线

可评估两类适配器：

- 外部本地服务，例如用户自行安装的 Ollama 兼容端点；
- 应用内本地 runtime，例如基于 llama.cpp、ONNX Runtime 或 Rust 推理库。

外部服务降低应用包体，但增加安装和端口安全问题；应用内 runtime 离线体验
更完整，但显著增加包体、内存、跨平台构建和模型分发成本。无论使用哪一种，
Provider 仍必须遵守相同 scope、tool schema、预算、输出校验和 eval。

### 9.4 不建议的初始组合

- 不同时引入 OpenAI Agents SDK、LangChain、LangGraph 和自研 Runner。
- 不为了单 Agent 流程引入多 Agent 编排。
- 不把云端向量数据库作为本地书库检索的默认依赖。
- 不把 MCP 当作内部普通函数调用的替代品。
- 不因为 Provider 支持 Hosted Tools 就默认把它们全部开放。

当流程确实需要持久状态图、分支恢复和人工审批恢复时，可以评估 LangGraph；
当 Provider 编排、handoff 和 trace 需求明显超过显式 Runner 时，可以评估
Agents SDK。二者应通过相同 eval 数据比较，而不是仅凭框架功能表选择。

## 10. Prompt 与上下文管理

### 10.1 Prompt 层次

```text
Application policy
  -> task instructions
  -> immutable capability grant summary
  -> tool descriptions
  -> user request
  -> untrusted retrieved content blocks
```

- 应用政策只写一次，保持短小并带版本号。
- 工具特定规则写在工具描述中，包括输入、输出、副作用和错误。
- grant 从应用生成，不能接受模型或书籍正文里的范围修改。
- 书籍、PDF、批注、笔记和搜索结果全部标记为 untrusted data。
- Retrieved content 中出现的“忽略规则”“调用工具”“发送文件”等文字只能
  当成书籍原文，不能成为新指令。
- 最终输出使用结构化 schema，不靠 prompt 描述 JSON 格式。

### 10.2 上下文策略

- 将稳定政策和工具描述与动态用户内容分开。
- 每轮只加入当前任务需要的 passage，不累计整本书。
- 长会话压缩为结构化摘要：已确认目标、允许范围、引用 ID、完成步骤、未解决
  问题；不保留无界原始对话。
- 对话历史默认不跨 run；用户明确保存后才形成可查看的长期记忆。
- 缓存 key 不使用书名、邮箱或其他可识别信息。
- 模型升级或 prompt 修改必须记录 `promptVersion` 并重跑 eval。

## 11. 安全与隐私

### 11.1 明确授权

远程 run 启动前展示：

- 用户问题；
- 供应商和模型；
- 允许访问的书籍、笔记和批注；
- 允许的工具；
- 首次发送的准确文本；
- 后续检索文本的最大总字符数；
- 是否允许外部网络工具，默认否；
- 供应商保留、训练和地区说明；
- 取消和 Send 操作。

对于后续 tool result，可以采用“一次运行 grant + 应用强制预算”的方式，
避免每个只读搜索都弹窗；但读取新的笔记、扩大书籍范围、调用外部工具或进行
任何用户数据写入时必须重新授权。

### 11.2 敏感内容

- 发送前在本地提示疑似 API Key、私钥、访问令牌、邮箱、电话和财务标识。
- 检测只是提示，不能声称识别了所有个人或敏感信息。
- 用户可以编辑、遮盖、取消或明确继续。
- 不通过另一个云模型做敏感信息预检。
- 不在日志、trace、analytics 或 crash report 中写入正文。

### 11.3 Prompt injection

安全依靠能力隔离，不依靠模型承诺：

- retrieved content 与系统指令结构化分离；
- 工具白名单和每次执行前 scope 校验；
- 无 Shell、SQL、任意 URL、任意文件或删除工具；
- 写操作在模型之外由 UI 审批；
- 工具输出有大小和字段限制；
- 模型输出不自动执行 HTML、Markdown 链接或图片；
- citation、本地跳转和写入内容由确定性代码校验；
- 恶意内容测试覆盖直接、间接、编码和多轮注入。

### 11.4 输出安全

- 默认以纯文本或受控 Markdown 渲染。
- 禁止原始 HTML、脚本、iframe、远程图片和自动打开链接。
- URL 显示真实 host，并由用户主动打开。
- 不从模型输出解析命令或 SQL。
- Structured Output 通过 Zod 校验，失败时进入可解释错误状态。
- 超长输出截断并标记，不静默写入不完整笔记。

### 11.5 数据保留说明

`store: false` 只是一项 API 请求设置，不能被产品文案描述为“供应商绝不
保留任何数据”。供应商政策、滥用监控、应用状态和区域能力可能不同，必须由
Provider adapter 提供可审查的 disclosure，并在政策变化时更新。

如果使用 OpenAI API，官方数据控制文档当前说明：API 数据默认不用于训练，
除非客户明确选择共享；默认滥用监控日志可能包含客户内容并保留最多 30 天；
Zero Data Retention/Modified Abuse Monitoring 需要满足资格并单独配置。

## 12. UI 与可访问性

### 12.1 入口

- 阅读选择工具栏：总结、解释、翻译、询问。
- 阅读器侧栏：当前 run、引用列表和草稿。
- 搜索页：在用户选定结果上发起研究任务。
- 笔记页：对当前选区或当前笔记发起受限任务。
- 设置页：Provider、本地模型、隐私说明、预算和一键关闭。

第一阶段不增加全局常驻聊天机器人。入口与当前阅读上下文绑定，更容易让用户
理解模型获得了什么数据。

### 12.2 必须呈现的状态

- AI 未启用；
- Provider 未配置；
- 本地模型不可用；
- 正在准备上下文；
- 等待发送确认；
- 正在流式生成；
- 正在调用工具；
- 等待写操作确认；
- 已取消；
- 网络不可用；
- 请求超时或限流；
- 输出无效；
- 没有足够证据；
- 引用失效；
- 完成并生成草稿。

### 12.3 无障碍要求

- 所有 Agent 入口和图标按钮有可访问名称。
- consent 和 approval 使用真正的对话框语义。
- 打开对话框后聚焦标题或第一个安全操作；关闭后恢复到触发按钮。
- 流式文本用不过度打扰的 live region，不逐 token 播报。
- 工具状态不只依赖颜色。
- Cancel 始终可通过键盘访问。
- 引用列表可按键盘定位并跳转回阅读器。
- 模型错误不会把焦点丢到页面顶部。

## 13. 可观测性与成本

### 13.1 默认本地指标

可以记录：

- run ID、task、Provider、模型和 promptVersion；
- 状态转换和错误码；
- 首 token 延迟和总耗时；
- 输入/输出 token；
- 工具名称、次数、耗时、结果条数和截断状态；
- 检索 top-k、引用验证数量和草稿接受/丢弃状态。

不得记录：

- 用户问题原文；
- 书籍、笔记、批注或模型输出正文；
- Provider Key、授权 token；
- 绝对路径；
- 原始工具参数或结果；
- 隐藏推理内容。

托管 trace 默认关闭。若开发环境需要，应仅使用公开 fixture 或用户明确授权的
测试内容，并确认 trace 的保留和地区策略。

### 13.2 成本与滥用限制

- 每 run 的 token、工具次数、超时和最大输出硬限制。
- 用户级并发 run 限制；同一书籍索引任务去重。
- 429 和临时网络失败指数退避，最多有限重试。
- UI 显示正在使用远程或本地模型。
- 可选显示本次 token 用量；金额估算只有价格配置来源可靠时才显示。
- 不在后台自动重试已取消或需要重新授权的任务。

## 14. 评估体系

Agent 功能的完成标准不是“模型看起来会回答”，而是可重复的数据集和硬性
安全断言。

### 14.1 测试分层

#### 确定性单元测试

- Zod schema 接受/拒绝边界值；
- 状态机只允许合法转换；
- scope grant 不能扩大；
- tool limit 和字符预算被强制执行；
- citation ID、locator、quote 和 hash 校验；
- 取消后忽略迟到事件；
- Provider 事件映射和未知事件失败；
- 输出 Markdown 消毒；
- `AiDraftService` 没有更新已有笔记的路径。

#### Fake Provider 轨迹测试

- 正常文本流；
- 单个和多个工具调用；
- 并行只读工具；
- 重复 tool call；
- 越权 book/note ID；
- malformed JSON 和未知工具；
- 工具超时、Provider 断流和 429；
- consent 前尝试发送；
- write tool 等待批准、拒绝和取消；
- 结束后到达的 delta。

#### Repository/平台测试

- Agent run 和 AI draft 持久化、映射、删除和迁移；
- OS 凭据存储成功、拒绝和缺失；
- API Key 不进入 SQLite、localStorage、备份和日志；
- 索引中断后的幂等重建；
- 删除书籍后派生 chunk/vector 清理；
- PDF/EPUB locator 映射和失效状态。

#### Playwright

- 选中文本 -> 预览 -> 发送 -> 流式结果 -> 创建草稿；
- 关闭预览时没有 Provider 调用；
- 取消运行并恢复焦点；
- 工具写入审批拒绝；
- 引用跳回 EPUB/PDF；
- Provider 未配置、离线、超时和无证据状态；
- axe 检查 consent、approval、Agent panel 和 draft。

### 14.2 Eval 数据集

只使用公共领域、合成或项目自有的无版权 fixture。第一版建议至少包含：

- 30 个单书事实问答和引用样例；
- 10 个跨章节综合问题；
- 10 个工具路由和停止条件样例；
- 10 个无答案或证据不足样例；
- 10 个 prompt injection/越权样例；
- 10 个长文本、RTL、fixed-layout、PDF 和损坏内容边界样例。

每个样例包含允许范围、期望工具集合、禁止工具、证据 chunk、可接受引用、
最大步骤和必须满足的安全断言。可以用模型 grader 辅助评估表达质量，但权限、
引用存在性、locator、工具范围和原文保留必须由确定性代码评分。

### 14.3 指标

硬性发布门槛：

- consent 前远程请求：0；
- 未授权数据返回：0；
- 未批准用户数据写入：0；
- 原笔记被替换或删除：0；
- 工具参数 schema 有效率：100%；
- 引用 locator schema 有效率：100%；
- 恶意 fixture 触发通用文件/SQL/网络执行：0；
- 取消后持久化写入：0。

质量指标先记录基线，再逐步提高：

- 任务完成率；
- 工具选择准确率；
- 引用可定位率；
- 引用支持回答的比例；
- 无答案识别率；
- 平均/95 分位工具调用次数；
- 首 token 与总延迟；
- 输入/输出 token；
- 用户草稿接受率和撤销率。

如果使用 OpenAI Evals，可以针对相同数据源定义多个 testing criteria，并在
不同模型和参数上运行；私有书籍不得上传为托管 eval 数据。无论使用托管还是
本地 eval，都必须在模型、prompt、工具描述、chunk 或排序策略变化时运行。

## 15. 分阶段开发计划

### Phase A — 无模型基础

- 定义 `AgentRun`、`AgentCapabilityGrant`、`AgentEvent`、`AgentToolResult`、
  `AgentCitation` 和 `AiDraft` schema。
- 实现状态机、预算器、scope policy 和 `FakeModelProvider`。
- 实现 exact-text consent、敏感内容提示、取消和结果区域。
- 完成禁止发送/禁止写入的确定性测试。
- 不安装远程 SDK，不增加网络权限，不创建真实 Provider。

验收：fake run 能完成、失败和取消；没有 consent 不会产生 provider event；
Agent 无法获得 `NoteRepository.update` 或任意平台能力。

### Phase B — 选中文本助手

- 选择一种 Provider 形态并完成 ADR。
- 实现流式 Gateway、超时、取消、用量和错误映射。
- 支持总结、解释、翻译、提纲和问题生成。
- 结果只生成 `AiDraft`。
- 加入 Provider disclosure 和关闭 AI 的设置。

验收：实际发送文本与预览逐字一致；取消/失败不写笔记；API Key 不出现在
WebView、SQLite、localStorage、日志或备份。

### Phase C — 单书本地 RAG

- 抽象 EPUB/PDF `BookTextExtractor`。
- 定义 chunk、版本和 locator 映射。
- 建立 FTS5 chunk index；评估本地 embedding index。
- 实现混合检索、预算、相邻合并和 citation validator。
- 增加单书问答和无证据 eval。

验收：所有显示为已验证的引用均能跳回原书；删除/替换书籍会清理或重建
派生索引；远程模型只收到范围内 top-k passage。

### Phase D — 工具型单 Agent

- 实现只读 Tool Registry。
- 加入有限 Agent loop、工具次数、并发和停止规则。
- 增加书籍、笔记和批注 scope grant。
- 为未来写工具加入审批状态，但只开放 `create_ai_draft`。
- 建立轨迹回放和工具路由 eval。

验收：Agent 无法扩大 grant；重复、越权或恶意 tool call 被确定性拒绝；复杂
任务完成后只生成草稿和验证引用。

### Phase E — 学习工作流和受控写入

- 闪卡、测验、复习和研究报告使用各自 structured output。
- 新建笔记或追加笔记变成逐次审批工具。
- 用户看到目标笔记、追加内容和引用预览。
- 拒绝审批后 Agent 可以结束或生成草稿，但不能换工具绕过。

验收：所有用户数据写入都有审批记录；没有 Replace/Delete；追加操作保留原始
节点并可在普通编辑器内撤销。

### Phase F — 可选高级能力

- 用 eval 证明后再选择 MCP、多 Agent、语音或长期记忆中的单项能力。
- 每项重新做权限、数据范围、保留策略、成本和故障模型评审。
- 不把高级能力默认加入所有用户的工具列表。

## 16. 技术选型决策点

实现前必须明确：

1. 只支持本地模型、用户自带 Key，还是应用提供的后端服务？
2. 若使用远程服务，谁拥有凭据、如何认证、如何限额？
3. embedding 在本地还是远程生成？书籍文本是否允许发送用于 embedding？
4. 本地向量实现的许可证、包体、迁移和三平台构建是否可接受？
5. Agent run 和草稿保留多久，用户如何查看和删除？
6. 哪些工具可在 run grant 内自动执行，哪些必须逐次审批？
7. 是否允许笔记作为检索源，默认范围是什么？
8. 是否需要离线 Agent，目标设备的内存和磁盘预算是多少？
9. 是否需要托管 trace/eval；如果需要，能否只使用公开 fixture？
10. 哪个 eval 指标证明需要多 Agent、MCP 或 reranker？

推荐初始答案是：单 Agent、选定书籍、本地检索、本地 embedding 优先、远程只
发送有限 passage、无托管正文 trace、只读工具自动执行、所有用户写入逐次
审批、多 Agent/MCP 延后。

## 17. 依赖原则

可复用现有依赖：

- Zod：工具、事件、structured output 和持久化 schema；
- SQLite FTS5：关键词检索；
- React/Radix：Agent panel、consent 和 approval；
- Tauri：原生 Provider、凭据和受限网络边界；
- Vitest/Playwright/axe：确定性测试和关键流程；
- `BookLocator`：引用和跳转；
- Tiptap：用户确认后的新建/追加内容。

可能新增但必须单独评估：

- OpenAI SDK 或 Agents SDK，仅放在安全的后端/原生边界；
- tokenizer；
- embedding runtime；
- 本地向量索引；
- reranker；
- OS credential adapter；
- MCP SDK；
- OpenTelemetry 或其他 trace exporter。

每个大型依赖都需要说明：解决的问题、替代方案、bundle/内存影响、许可证、
浏览器和 Tauri 兼容性、三平台构建、离线行为、数据流和移除成本。

## 18. Go/no-go 条件

AI Agent 第一版只有满足以下条件才可以进入用户测试：

- 无 AI 配置时应用功能和启动路径完全不受影响；
- 每次远程 run 都有精确范围、Provider、预算和发送内容确认；
- Agent 不持有 Repository、SQL、Tauri、任意文件或任意网络能力；
- scope policy 在模型之外强制执行；
- 所有模型和工具输入/输出有版本化 schema 和大小上限；
- 取消、断网、限流、无效输出和工具失败都有明确 UI 状态；
- AI 结果只进入独立草稿，不提供 Replace/Delete；
- 引用由本地代码验证并可跳转或明确标记失效；
- 敏感内容提示、Provider disclosure 和删除设置已经可用；
- 硬性安全 eval 全部通过，质量、延迟和成本基线已经记录；
- 真实用户内容不会进入日志、CI artifact 或未经授权的 trace/eval。

## 19. 官方资料基线

以下资料于 2026-09-03 核对；实现时应重新确认 API、数据保留和 SDK 行为：

- [OpenAI Developer Quickstart](https://platform.openai.com/docs/quickstart/make-your-first-api-request)：Responses 流式调用和后端 Agents SDK 基线。
- [OpenAI Responses API](https://developers.openai.com/api/reference/cli/resources/responses/methods/retrieve)：工具类别、工具选择、结构化输出、状态和用量字段。
- [OpenAI Evals API](https://developers.openai.com/api/reference/java/resources/evals/methods/create)：数据源、testing criteria 和 grader 基线。
- [OpenAI 数据控制](https://developers.openai.com/api/docs/guides/your-data)：训练、滥用监控、应用状态和 Zero Data Retention 说明。
- [OWASP Prompt Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)：间接注入、结构化隔离、最小权限和人工审批参考。
