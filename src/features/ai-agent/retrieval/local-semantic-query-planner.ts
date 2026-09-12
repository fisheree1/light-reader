import { agentModelRequestSchema } from '../../../platform/ai/model-provider-gateway';
import type { ModelProviderGateway } from '../../../platform/ai/model-provider-gateway';
import { isAppError } from '../../../lib/app-error';
import { createUuid } from '../../../lib/id';
import type { AiSettings } from '../domain/ai-settings';
import { bookQuestionSchema } from './book-retrieval';
import { ProviderTextRunner } from '../services/provider-text-runner';

function parseTerms(value: string, question: string): string[] {
  const original = question.toLocaleLowerCase();
  return [
    ...new Set(
      value
        .split(/[\n,，;；]+/)
        .map((term) =>
          term
            .replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '')
            .trim()
            .toLocaleLowerCase(),
        )
        .filter(
          (term) =>
            Array.from(term).length >= 2 &&
            Array.from(term).length <= 32 &&
            !original.includes(term),
        ),
    ),
  ].slice(0, 6);
}

/** Local-only query expansion. It improves recall but is not a vector embedding. */
export class LocalSemanticQueryPlanner {
  private readonly runner: ProviderTextRunner;

  constructor(provider: ModelProviderGateway, timeoutMs = 20_000) {
    this.runner = new ProviderTextRunner(provider, timeoutMs);
  }

  async expand(
    value: string,
    settings: AiSettings,
    signal: AbortSignal,
  ): Promise<string[]> {
    const question = bookQuestionSchema.parse(value);
    try {
      const result = await this.runner.run(
        agentModelRequestSchema.parse({
          schemaVersion: 1,
          runId: createUuid(),
          endpoint: settings.endpoint,
          model: settings.model,
          systemPrompt:
            '你是本地检索查询规划器。只输出 2 到 6 行简短检索词，每行一个；包括同义表达、相关概念或中英文术语。不得回答问题，不得输出编号或解释。',
          prompt: `为下面的研究问题生成本地图书检索词：\n${question}`,
          maxOutputChars: 600,
        }),
        signal,
      );
      return parseTerms(result.content, question);
    } catch (error) {
      if (isAppError(error) && error.code === 'USER_CANCELLED') throw error;
      return [];
    }
  }
}

export { parseTerms as parseSemanticQueryTerms };
