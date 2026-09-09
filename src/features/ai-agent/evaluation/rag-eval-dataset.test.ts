import { describe, expect, it } from 'vitest';

import type { BookChunkRepository } from '../../../database/repositories/book-chunk-repository';
import { LocalHybridBookCandidateRetriever } from '../retrieval/book-candidate-retriever';
import {
  extractBookQueryTerms,
  scoreBookChunkTerms,
  type BookChunk,
} from '../retrieval/book-retrieval';
import {
  ragEvalDatasetV1,
  ragEvalDatasetV2,
  type RagEvalCase,
} from './rag-eval-dataset';

function createChunk(testCase: RagEvalCase, index: number): BookChunk {
  const passage = testCase.passages[index];
  return {
    schemaVersion: 1,
    id: `chunk-${String(index)}`,
    bookId: 'eval-book',
    sourceFileHash: 'a'.repeat(64),
    chapterHref:
      passage.locator.format === 'epub'
        ? (passage.locator.chapterHref ?? null)
        : null,
    chapterTitle: passage.chapterTitle,
    startLocator: passage.locator,
    endLocator: null,
    text: passage.text,
    textHash: `fnv1a-${String(index).padStart(8, '0')}`,
    estimatedTokens: Math.max(1, Math.ceil(passage.text.length / 2)),
    ordinal: index,
  };
}

function createRepository(chunks: BookChunk[]): BookChunkRepository {
  return {
    findById: () => Promise.resolve(null),
    getIndexedSourceHash: () => Promise.resolve(null),
    replaceBookChunks: () => Promise.resolve(),
    searchBookChunks: (_bookId, terms, limit) =>
      Promise.resolve(
        chunks
          .map((chunk) => ({
            chunk,
            score: scoreBookChunkTerms(chunk.text, terms),
          }))
          .filter((match) => match.score > 0)
          .sort(
            (left, right) =>
              right.score - left.score ||
              left.chunk.ordinal - right.chunk.ordinal,
          )
          .slice(0, limit),
      ),
  };
}

async function retrievePassageIndexes(testCase: RagEvalCase) {
  const chunks = testCase.passages.map((_passage, index) =>
    createChunk(testCase, index),
  );
  const retriever = new LocalHybridBookCandidateRetriever(
    createRepository(chunks),
  );
  const matches = await retriever.retrieve('eval-book', testCase.question, 6);
  return matches.map((match) => match.chunk.ordinal);
}

describe('RAG evaluation dataset v2', () => {
  it('keeps every required retrieval case above the P2 acceptance threshold', async () => {
    const results = await Promise.all(
      ragEvalDatasetV2.map(async (testCase) => ({
        actual: await retrievePassageIndexes(testCase),
        testCase,
      })),
    );
    let recalledPassages = 0;
    let expectedPassages = 0;
    let correctNoAnswerCases = 0;
    let noAnswerCases = 0;

    for (const { actual, testCase } of results) {
      if (testCase.expectedPassageIndexes.length === 0) {
        noAnswerCases += 1;
        if (actual.length === 0) correctNoAnswerCases += 1;
        expect(actual, testCase.id).toEqual([]);
        continue;
      }
      expectedPassages += testCase.expectedPassageIndexes.length;
      recalledPassages += testCase.expectedPassageIndexes.filter((index) =>
        actual.includes(index),
      ).length;
      expect(actual, testCase.id).toEqual(
        expect.arrayContaining(testCase.expectedPassageIndexes),
      );
    }

    expect(recalledPassages / expectedPassages).toBeGreaterThanOrEqual(0.9);
    expect(correctNoAnswerCases / noAnswerCases).toBe(1);
  });

  it('recalls the recorded semantic paraphrase through local query expansion', async () => {
    const semanticCase = ragEvalDatasetV2.find(
      (testCase) => testCase.category === 'semantic-paraphrase',
    );
    expect(semanticCase).toBeDefined();
    if (!semanticCase) return;

    await expect(retrievePassageIndexes(semanticCase)).resolves.toEqual(
      semanticCase.expectedPassageIndexes,
    );

    const lexicalTerms = extractBookQueryTerms(semanticCase.question);
    expect(
      semanticCase.passages
        .map((passage, index) => ({
          index,
          score: scoreBookChunkTerms(passage.text, lexicalTerms),
        }))
        .filter((match) => match.score > 0),
    ).toEqual([]);
    expect(
      ragEvalDatasetV1.find((testCase) => testCase.id === semanticCase.id)
        ?.knownLimitation,
    ).toBe(true);
  });

  it('covers both EPUB and PDF locators with versioned positions', () => {
    const locators = ragEvalDatasetV2.flatMap((testCase) =>
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
