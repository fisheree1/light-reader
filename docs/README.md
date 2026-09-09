# LightReader 文档地图

本文档目录记录已经实现的功能边界、仍在评估的方案，以及重要技术决策。根目录 [`README.md`](../README.md) 只负责产品概览、安装运行和常用入口；具体行为以本目录中的对应文档为准。

## 已实现能力

| 主题 | 权威文档                                         | 内容                                              |
| ---- | ------------------------------------------------ | ------------------------------------------------- |
| 导入 | [`book-import.md`](book-import.md)               | EPUB/PDF 导入、文件校验、受控路径与失败回滚       |
| 书架 | [`library-management.md`](library-management.md) | 收藏、标签、排序和安全删除事务                    |
| 阅读 | [`reader-engine.md`](reader-engine.md)           | Foliate/PDF.js、locator、交互、生命周期和内容安全 |
| 笔记 | [`notes-editor.md`](notes-editor.md)             | Tiptap schema、引用块、自动保存和恢复             |
| 搜索 | [`local-search.md`](local-search.md)             | FTS5、正文抽取、索引重建和 AI 单书检索索引        |
| 导出 | [`export-formats.md`](export-formats.md)         | 笔记与批注的稳定导出格式                          |
| 备份 | [`data-backup.md`](data-backup.md)               | 数据库/完整备份、预检、恢复和迁移快照             |
| 测试 | [`testing.md`](testing.md)                       | CI、覆盖率基线和交付门禁                          |
| 发布 | [`release.md`](release.md)                       | 跨平台安装包、版本一致性和真实桌面验收            |

## AI

- [`ai-agent-development.md`](ai-agent-development.md)：产品范围、架构、工具协议、检索、安全、评估和路线图。
- [`ai-local-model-baseline.md`](ai-local-model-baseline.md)：本机模型实测基线。
- [`ai-ollama-tool-calling-evaluation.md`](ai-ollama-tool-calling-evaluation.md)：Ollama 工具调用的专项评估证据。

## 未来能力

- [`cloud-sync-evaluation.md`](cloud-sync-evaluation.md)：尚未实现的端到端加密云同步方案与准入条件。

## 架构决策记录

`adr/` 保存“为什么这样设计”的历史决策。ADR 即使与当前实现文档存在少量背景重叠也不应删除；被替代时应标记为 superseded，并链接新的 ADR。

- [`adr/0001-local-ollama-provider.md`](adr/0001-local-ollama-provider.md)
- [`adr/0002-local-rag-readonly-agent.md`](adr/0002-local-rag-readonly-agent.md)
- [`adr/0003-local-hybrid-lexical-retrieval.md`](adr/0003-local-hybrid-lexical-retrieval.md)

## 维护约定

- README 只保留入口信息，不复制功能实现细节。
- 功能文档描述当前行为；ADR 记录不可变的决策背景；评估文档保存可复现的测试证据。
- 同一规则只保留一个权威来源，其他位置使用链接。
- 功能行为、数据格式或交付门禁变化时，在同一提交中更新对应权威文档。
