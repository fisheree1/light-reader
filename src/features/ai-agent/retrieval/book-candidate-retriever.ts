import type { BookChunkRepository } from '../../../database/repositories/book-chunk-repository';
import { throwIfBookIndexingAborted } from './book-indexing';
import {
  bookChunkMatchSchema,
  extractBookQueryTerms,
  scoreBookChunkTerms,
  type BookChunkMatch,
} from './book-retrieval';

const reciprocalRankConstant = 60;
const maximumRecallCount = 8;

interface SemanticExpressionGroup {
  expressions: string[];
  terms: string[];
}

const semanticExpressionGroups: SemanticExpressionGroup[] = [
  {
    expressions: ['断网', '无网络', '没有网络', 'offline', 'without internet'],
    terms: ['离线', '断网', 'offline'],
  },
  {
    expressions: ['保存', '存储', '存放', 'stored', 'saved', 'storage'],
    terms: ['保存', '存储', 'stored', 'saved'],
  },
  {
    expressions: ['隐私', '个人数据', 'privacy', 'private data'],
    terms: ['隐私', '个人数据', 'privacy'],
  },
  {
    expressions: ['高亮', '标注', '批注', 'highlight', 'annotation'],
    terms: ['高亮', '标注', '批注', 'highlight', 'annotation'],
  },
  {
    expressions: ['章节', '章回', 'chapter', 'section'],
    terms: ['章节', '章回', 'chapter', 'section'],
  },
  {
    expressions: ['作者', '写作者', 'author', 'writer'],
    terms: ['作者', '写作者', 'author', 'writer'],
  },
];

export interface BookQueryPlan {
  expandedTerms: string[];
  lexicalTerms: string[];
}

export interface BookCandidateRetriever {
  retrieve(
    bookId: string,
    question: string,
    limit: number,
    signal?: AbortSignal,
    semanticTerms?: string[],
  ): Promise<BookChunkMatch[]>;
}

function normalizeExpression(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function uniqueTerms(values: string[]): string[] {
  return [...new Set(values.map(normalizeExpression).filter(Boolean))].slice(
    0,
    12,
  );
}

export function buildBookQueryPlan(
  question: string,
  semanticTerms: string[] = [],
): BookQueryPlan {
  const normalizedQuestion = normalizeExpression(question);
  const lexicalTerms = extractBookQueryTerms(question);
  const lexicalSet = new Set(lexicalTerms);
  const expandedTerms = [
    ...semanticTerms,
    ...semanticExpressionGroups.flatMap((group) =>
      group.expressions.some((expression) =>
        normalizedQuestion.includes(expression),
      )
        ? group.terms
        : [],
    ),
  ];
  return {
    lexicalTerms,
    expandedTerms: uniqueTerms(expandedTerms).filter(
      (term) => !lexicalSet.has(term),
    ),
  };
}

interface FusedCandidate {
  match: BookChunkMatch;
  reciprocalRank: number;
}

export function fuseAndRerankBookCandidates(
  rankedLists: BookChunkMatch[][],
  query: BookQueryPlan,
  limit: number,
): BookChunkMatch[] {
  const candidates = new Map<string, FusedCandidate>();
  for (const matches of rankedLists) {
    matches.forEach((match, index) => {
      const current = candidates.get(match.chunk.id);
      const reciprocalRank =
        1 / (reciprocalRankConstant + index + 1) +
        (current?.reciprocalRank ?? 0);
      candidates.set(match.chunk.id, {
        match:
          !current || match.score > current.match.score ? match : current.match,
        reciprocalRank,
      });
    });
  }

  return [...candidates.values()]
    .map(({ match, reciprocalRank }) => {
      const searchableText = `${match.chunk.chapterTitle ?? ''}\n${match.chunk.text}`;
      const lexicalHits = scoreBookChunkTerms(
        searchableText,
        query.lexicalTerms,
      );
      const expandedHits = scoreBookChunkTerms(
        searchableText,
        query.expandedTerms,
      );
      return bookChunkMatchSchema.parse({
        chunk: match.chunk,
        score:
          reciprocalRank * 100 +
          lexicalHits * 8 +
          expandedHits * 4 +
          Math.min(match.score, 4),
      });
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.chunk.ordinal - right.chunk.ordinal,
    )
    .slice(0, Math.max(1, Math.min(maximumRecallCount, limit)));
}

export class LocalHybridBookCandidateRetriever implements BookCandidateRetriever {
  private readonly repository: BookChunkRepository;

  constructor(repository: BookChunkRepository) {
    this.repository = repository;
  }

  async retrieve(
    bookId: string,
    question: string,
    limit: number,
    signal?: AbortSignal,
    semanticTerms: string[] = [],
  ): Promise<BookChunkMatch[]> {
    throwIfBookIndexingAborted(signal);
    const query = buildBookQueryPlan(question, semanticTerms);
    if (query.lexicalTerms.length === 0 && query.expandedTerms.length === 0) {
      return [];
    }
    const recallLimit = Math.max(
      1,
      Math.min(maximumRecallCount, Math.max(limit, limit * 2)),
    );
    const searches: Promise<BookChunkMatch[]>[] = [];
    if (query.lexicalTerms.length > 0) {
      searches.push(
        this.repository.searchBookChunks(
          bookId,
          query.lexicalTerms,
          recallLimit,
        ),
      );
    }
    if (query.expandedTerms.length > 0) {
      searches.push(
        this.repository.searchBookChunks(
          bookId,
          query.expandedTerms,
          recallLimit,
        ),
      );
    }
    const rankedLists = await Promise.all(searches);
    throwIfBookIndexingAborted(signal);
    return fuseAndRerankBookCandidates(rankedLists, query, limit);
  }
}
