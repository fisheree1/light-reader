import type { Book } from '../../library/domain/book';
import {
  agentCitationSchema,
  hashAgentText,
  type AgentCitation,
  type AgentRun,
} from '../domain/agent';
import type { RetrievedPassage } from './book-retrieval';

export class CitationValidator {
  create(
    run: AgentRun,
    book: Book,
    passages: RetrievedPassage[],
  ): AgentCitation[] {
    return passages.map((passage, index) =>
      agentCitationSchema.parse({
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
        validation:
          passage.bookId === book.id && passage.sourceFileHash === book.fileHash
            ? 'verified'
            : 'stale',
      }),
    );
  }
}
