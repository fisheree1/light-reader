import type { AgentCapabilityGrant, AgentToolResult } from '../domain/agent';

export class AgentScopePolicy {
  authorizeSelection(
    grant: AgentCapabilityGrant,
    bookId: string,
    text: string,
    now: number,
  ): AgentToolResult<{ bookId: string; text: string }> {
    if (grant.approvedAt === null) {
      return {
        ok: false,
        code: 'APPROVAL_REQUIRED',
        message: '必须先确认发送内容。',
        retryable: false,
      };
    }
    if (now > grant.expiresAt || !grant.allowedBookIds.includes(bookId)) {
      return {
        ok: false,
        code: 'OUT_OF_SCOPE',
        message: '本次授权已经失效或不包含这本书。',
        retryable: false,
      };
    }
    if (
      text.length === 0 ||
      text.length > grant.maxCharsPerToolResult ||
      text.length > grant.maxTotalContextChars
    ) {
      return {
        ok: false,
        code: 'BUDGET_EXCEEDED',
        message: '发送文本超过本次运行的字符预算。',
        retryable: false,
      };
    }
    return {
      ok: true,
      data: { bookId, text },
      truncated: false,
      returnedChars: text.length,
    };
  }
}
