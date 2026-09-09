import type { Book } from '../../library/domain/book';
import {
  agentToolCallSchema,
  agentToolTraceEntrySchema,
  type AgentToolCall,
  type AgentToolTraceEntry,
} from '../domain/agent-tool';
import {
  hashAgentText,
  type AgentCapabilityGrant,
  type AgentToolResult,
} from '../domain/agent';
import type { BookRetrievalService } from '../retrieval/book-retrieval-service';
import type { RetrievedPassage } from '../retrieval/book-retrieval';

type ToolData = RetrievedPassage[] | RetrievedPassage;

function rejected(
  code: 'OUT_OF_SCOPE' | 'BUDGET_EXCEEDED' | 'APPROVAL_REQUIRED',
  message: string,
): AgentToolResult<ToolData> {
  return { ok: false, code, message, retryable: false };
}

export class AgentToolRegistry {
  private readonly allowedChunkIds = new Set<string>();
  private readonly book: Book;
  private readonly grant: AgentCapabilityGrant;
  private readonly now: () => number;
  private readonly retrieval: BookRetrievalService;
  private readonly seenCalls = new Set<string>();
  private readonly trace: AgentToolTraceEntry[] = [];
  private totalContextChars = 0;

  constructor(
    retrieval: BookRetrievalService,
    grant: AgentCapabilityGrant,
    book: Book,
    now: () => number = Date.now,
  ) {
    this.retrieval = retrieval;
    this.grant = grant;
    this.book = book;
    this.now = now;
  }

  async execute(value: AgentToolCall): Promise<AgentToolResult<ToolData>> {
    const call = agentToolCallSchema.parse(value);
    const authorization = this.authorize(call);
    if (authorization) {
      this.record(call, 'rejected', 0, null);
      return authorization;
    }
    const signature = JSON.stringify({
      name: call.name,
      arguments: call.arguments,
    });
    this.seenCalls.add(signature);
    try {
      const result =
        call.name === 'search_books'
          ? await this.searchBooks(call)
          : await this.readPassage(call);
      if (!result.ok) {
        this.record(call, 'rejected', 0, null);
        return result;
      }
      if (
        result.returnedChars > this.grant.maxCharsPerToolResult ||
        this.totalContextChars + result.returnedChars >
          this.grant.maxTotalContextChars
      ) {
        this.record(call, 'rejected', 0, null);
        return rejected('BUDGET_EXCEEDED', '工具结果超过本次运行的文本预算。');
      }
      this.totalContextChars += result.returnedChars;
      this.record(
        call,
        'completed',
        result.returnedChars,
        hashAgentText(JSON.stringify(result.data)),
      );
      return result;
    } catch {
      this.record(call, 'failed', 0, null);
      return {
        ok: false,
        code: 'UNAVAILABLE',
        message: '本地只读工具暂时不可用。',
        retryable: true,
      };
    }
  }

  getTrace(): AgentToolTraceEntry[] {
    return structuredClone(this.trace);
  }

  private authorize(call: AgentToolCall): AgentToolResult<ToolData> | null {
    if (this.grant.approvedAt === null) {
      return rejected('APPROVAL_REQUIRED', '必须先确认本次图书问答范围。');
    }
    if (
      this.now() > this.grant.expiresAt ||
      !this.grant.allowedTools.includes(call.name) ||
      !this.grant.allowedBookIds.includes(this.book.id)
    ) {
      return rejected('OUT_OF_SCOPE', '工具调用不在本次授权范围内。');
    }
    if (this.trace.length >= this.grant.maxToolCalls) {
      return rejected('BUDGET_EXCEEDED', '已达到本次运行的工具调用上限。');
    }
    const signature = JSON.stringify({
      name: call.name,
      arguments: call.arguments,
    });
    if (this.seenCalls.has(signature)) {
      return rejected('BUDGET_EXCEEDED', '拒绝重复的工具调用。');
    }
    const requestedBookIds =
      call.name === 'search_books'
        ? call.arguments.bookIds
        : [call.arguments.bookId];
    if (
      requestedBookIds.length !== 1 ||
      requestedBookIds[0] !== this.book.id ||
      !this.grant.allowedBookIds.includes(requestedBookIds[0])
    ) {
      return rejected('OUT_OF_SCOPE', '工具不能扩大到其他图书。');
    }
    return null;
  }

  private async searchBooks(
    call: Extract<AgentToolCall, { name: 'search_books' }>,
  ): Promise<AgentToolResult<ToolData>> {
    const passages = await this.retrieval.retrieve(
      this.book,
      call.arguments.query,
      call.arguments.limit,
    );
    passages.forEach((passage) => {
      passage.sourceChunkIds.forEach((id) => this.allowedChunkIds.add(id));
    });
    return {
      ok: true,
      data: passages,
      truncated: passages.length === call.arguments.limit,
      returnedChars: passages.reduce(
        (total, passage) => total + passage.text.length,
        0,
      ),
    };
  }

  private async readPassage(
    call: Extract<AgentToolCall, { name: 'read_passage' }>,
  ): Promise<AgentToolResult<ToolData>> {
    if (!this.allowedChunkIds.has(call.arguments.chunkId)) {
      return rejected('OUT_OF_SCOPE', '只能读取本次搜索已返回的文本块。');
    }
    const passage = await this.retrieval.readChunk(
      this.book,
      call.arguments.chunkId,
    );
    if (!passage) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: '文本块已失效，需要重建索引。',
        retryable: false,
      };
    }
    return {
      ok: true,
      data: passage,
      truncated: false,
      returnedChars: passage.text.length,
    };
  }

  private record(
    call: AgentToolCall,
    status: AgentToolTraceEntry['status'],
    returnedChars: number,
    resultHash: string | null,
  ): void {
    this.trace.push(
      agentToolTraceEntrySchema.parse({
        schemaVersion: 1,
        callId: call.callId,
        name: call.name,
        status,
        returnedChars,
        resultHash,
      }),
    );
  }
}
