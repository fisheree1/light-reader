import { describe, expect, it } from 'vitest';

import {
  extractBookQueryTerms,
  scoreBookChunkTerms,
} from '../retrieval/book-retrieval';
import { ragEvalDatasetV1 } from './rag-eval-dataset';

function retrievePassageIndexes(
  question: string,
  passages: { text: string }[],
) {
  const terms = extractBookQueryTerms(question);
  return passages
    .map((passage, index) => ({
      index,
      score: scoreBookChunkTerms(passage.text, terms),
    }))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((match) => match.index);
}

describe('RAG evaluation dataset v1', () => {
  it('keeps direct, cross-chapter, no-answer, and injection cases deterministic', () => {
    const requiredCases = ragEvalDatasetV1.filter(
      (testCase) => !testCase.knownLimitation,
    );

    for (const testCase of requiredCases) {
      const actual = retrievePassageIndexes(
        testCase.question,
        testCase.passages,
      );
      if (testCase.expectedPassageIndexes.length === 0) {
        expect(actual, testCase.id).toEqual([]);
      } else {
        expect(actual, testCase.id).toEqual(
          expect.arrayContaining(testCase.expectedPassageIndexes),
        );
      }
    }
  });

  it('records semantic paraphrase recall as an explicit keyword baseline gap', () => {
    const semanticGap = ragEvalDatasetV1.find(
      (testCase) => testCase.category === 'semantic-gap',
    );
    expect(semanticGap).toBeDefined();
    expect(
      retrievePassageIndexes(
        semanticGap?.question ?? '',
        semanticGap?.passages ?? [],
      ),
    ).toEqual([]);
  });

  it('covers both EPUB and PDF locators with versioned positions', () => {
    const locators = ragEvalDatasetV1.flatMap((testCase) =>
      testCase.passages.map((passage) => passage.locator),
    );
    expect(locators.some((locator) => locator.format === 'epub')).toBe(true);
    expect(
      locators.some(
        (locator) =>
          locator.format === 'pdf' && locator.textRange !== undefined,
      ),
    ).toBe(true);
  });
});
