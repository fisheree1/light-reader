import { describe, expect, it } from 'vitest';

import { parseSemanticQueryTerms } from './local-semantic-query-planner';

describe('local semantic query planning', () => {
  it('normalizes, deduplicates, and bounds model-generated terms', () => {
    expect(
      parseSemanticQueryTerms(
        '1. 个人数据\n- 隐私保护\n个人数据\n这是一条明显超过三十二个字符所以不能进入本地检索计划的无界模型输出',
        '数据边界是什么？',
      ),
    ).toEqual(['个人数据', '隐私保护']);
  });
});
