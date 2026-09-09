# Ollama 原生工具调用评估

状态：暂不启用。

更新日期：2026-09-09。

## 结论

LightReader 当前继续使用应用自己编排的确定性单次检索，不将
Ollama 原生 `tool_calls` 接入主流程，也不引入通用 Agent 框架。

这不是 Ollama API 缺少工具字段，而是当前“模型 + 模板 + LightReader
传输层”组合尚未达到稳定交付门槛。现有方案仍然保留了 Agent 的核心
安全边界：限时单书授权、只读工具注册表、调用和文本预算、不记录
原文的轨迹，以及只能生成独立草稿。

## 实机评估

评估环境：

- Ollama 客户端：`0.33.3`；
- 模型：`deepseek-r1:8b`；
- 模型 ID：`6995872bfe4c`；
- 模型元数据声明：`tools`、`thinking`、`completion`；
- 测试工具：只接收两个整数的 `calculator`；
- 测试输入：无私有图书或用户数据的 `2 + 3`。

两次 `/api/chat` 请求都提供了 Ollama `tools` schema。第一次限制 64
token，第二次提高到 512 token；两次都只返回 `message.thinking`，因输出
上限结束，没有返回 `message.tool_calls`。因此不能仅根据元数据的
`tools` 标记宣称该模型可靠支持结构化工具调用。

## 现有工程缺口

`ModelProviderGateway` 正确声明 `functionTools: false`。Tauri 侧发往
`/api/chat` 的请求没有 `tools` 或 `tool_choice`，流式响应只反序列化
`message.content`，也没有对 `message.tool_calls` 建模。即使更换为能稳定输出
工具调用的模型，仍需完成以下工作才能开启能力：

1. 为 request、stream event 和 tool call 增加版本化 schema；
2. 在 Rust 中限制工具名、参数大小、调用数和响应长度；
3. 每次执行前重新经过 scope policy，不信任模型提供的 book ID 或 chunk ID；
4. 实现有限步数的循环、重复调用检测、取消、超时和错误收敛；
5. 用固定 eval 数据证明工具选择正确率和最终回答质量高于确定性基线。

## 以后的启用门槛

只有同时满足以下条件才把 `functionTools` 改为 `true`：

- 选定模型在固定参数下连续 50 次最小工具调用无结构错误；
- 越权 book ID、未知工具、非法参数和 prompt injection 全部被确定性拒绝；
- 超时、取消和模型中途结束时不写入用户数据；
- P95 总时延和内存峰值在目标设备预算内；
- 与当前确定性单检索基线相比，RAG eval 的引用可定位率不下降，
  且跨章节问题质量有可重复的提升。

在此之前，保持确定性编排是稳定性和可审计性更高的产品决策。
