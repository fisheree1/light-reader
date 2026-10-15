import type { AgentCapabilityGrant, AgentToolResult } from '../domain/agent';
import { translate } from '../../../i18n/i18n';

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
        message: translate('ai.confirmFirst'),
        retryable: false,
      };
    }
    if (now > grant.expiresAt || !grant.allowedBookIds.includes(bookId)) {
      return {
        ok: false,
        code: 'OUT_OF_SCOPE',
        message: translate('ai.grantExpired'),
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
        message: translate('ai.budgetExceeded'),
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
