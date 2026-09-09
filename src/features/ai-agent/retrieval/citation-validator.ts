import type { Book } from '../../library/domain/book';
import {
  agentCitationSchema,
  hashAgentText,
  type AgentCitation,
  type AgentRun,
} from '../domain/agent';
import type { RetrievedPassage } from './book-retrieval';

const citationMarkerPattern = /\[S(\d+)\]/g;

export function extractCitedPassageIndexes(
  output: string,
  passageCount: number,
): number[] {
  const indexes = Array.from(output.matchAll(citationMarkerPattern), (match) =>
    Number(match[1]),
  );
  if (indexes.length === 0) {
    throw new Error('The grounded answer did not cite any retrieved passage.');
  }
  if (
    indexes.some(
      (index) => !Number.isInteger(index) || index < 1 || index > passageCount,
    )
  ) {
    throw new Error('The grounded answer cited an unavailable passage.');
  }
  return [...new Set(indexes)].map((index) => index - 1);
}

export class CitationValidator {
  create(
    run: AgentRun,
    book: Book,
    passages: RetrievedPassage[],
    output: string,
  ): AgentCitation[] {
    return extractCitedPassageIndexes(output, passages.length).map((index) => {
      const passage = passages[index];
      if (
        passage.bookId !== book.id ||
        passage.sourceFileHash !== book.fileHash
      ) {
        throw new Error('Cited passage no longer matches the current book.');
      }
      return agentCitationSchema.parse({
        schemaVersion: 1,
        id: `citation-${hashAgentText(
          `${run.id}:${passage.id}:${String(index)}`,
        ).slice(6)}`,
        runId: run.id,
        bookId: book.id,
        bookTitleSnapshot: book.title,
        chapterTitleSnapshot: passage.chapterTitle,
        locator: passage.startLocator,
        quote: passage.text,
        sourceChunkId: passage.sourceChunkIds[0],
        sourceTextHash: passage.textHash,
        validation: 'verified',
        supportValidation: 'not-assessed',
      });
    });
  }
}
