# ADR 0001：第一版 AI 使用本地 Ollama Provider

- 状态：已接受
- 日期：2026-09-08
- 范围：LightReader AI Phase A/B

## 决策

第一版 AI 仅支持用户自行安装的本地 Ollama，默认模型为
`deepseek-r1:8b`，固定端点为 `http://127.0.0.1:11434`；同时兼容同端口的
`http://localhost:11434`。不接受其他端口、远程主机、重定向、凭据或任意
URL。

React 只调用 `AgentFacade`。`OllamaModelProvider` 通过以下 Tauri command
访问 Rust Gateway：

- `ai_ollama_status`：读取本机模型列表；
- `ai_ollama_chat`：发起受限的流式生成；
- `ai_cancel_ollama_run`：取消当前 run。

Rust 使用关闭重定向的 `reqwest` 客户端，并通过 Tauri Channel 返回版本化
事件。WebView 不获得 HTTP、Shell、文件或数据库能力。原生 Gateway 不接收
文件路径、Repository、SQL、笔记 ID 或 API Key。

AI 默认关闭。每次运行只发送用户在确认对话框中看到并批准的选中文本；模型
思考内容不进入 React、SQLite、localStorage、日志或备份。生成结果先成为内存
中的 `AiDraft`，用户明确确认后才通过普通 `NoteService` 创建新笔记。

## 原因

- 复用用户现有模型，不增加模型分发、安装包和云端凭据成本；
- 保持离线与本地优先；
- 将模型协议隔离在平台层，后续可以替换 Provider；
- 固定回环端点比向 WebView 开放任意网络权限更容易审计。

## 新增依赖

- `reqwest`：Rust 原生 Ollama HTTP/NDJSON 流；关闭默认特性，只启用 JSON 和
  stream；
- `futures-util`：读取有界响应流。

这两个依赖不进入前端 bundle。替代方案是 Tauri HTTP 插件，但它需要给
WebView 增加网络能力，边界更宽，因此不采用。

## 非目标

- 云模型、API Key、远程 Ollama；
- embedding、向量数据库、RAG；
- LangChain、LangGraph、Agents SDK、MCP、多 Agent；
- 自动更新、覆盖或删除笔记；
- 保存 prompt、正文、模型输出或隐藏推理轨迹。

## 验证

- Rust 单元测试拒绝远程、错误端口和带路径端点；
- Adapter 测试覆盖事件校验、取消、超时和无效输出；
- UI 测试覆盖精确文本确认、失败不写入、创建新笔记与焦点恢复；
- 本地 smoke test 记录模型版本、首 token 延迟、总耗时和取消响应时间，不把
  私有书籍或正文写入报告。
