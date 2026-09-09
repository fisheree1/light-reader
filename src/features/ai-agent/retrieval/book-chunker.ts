import type { Book } from '../../library/domain/book';
import { throwIfBookIndexingAborted } from './book-indexing';
import { hashAgentText } from '../domain/agent';
import {
  bookChunkSchema,
  type BookChunk,
  type BookTextBlock,
} from './book-retrieval';

const targetChars = 1_100;
const minimumBreakChars = 600;
const overlapChars = 120;

function findChunkEnd(text: string, start: number): number {
  const maximum = Math.min(text.length, start + targetChars);
  if (maximum === text.length) return maximum;
  const candidate = text.slice(start + minimumBreakChars, maximum);
  const boundary = Math.max(
    candidate.lastIndexOf('\n'),
    candidate.lastIndexOf('。'),
    candidate.lastIndexOf('！'),
    candidate.lastIndexOf('？'),
    candidate.lastIndexOf('. '),
  );
  return boundary >= 0 ? start + minimumBreakChars + boundary + 1 : maximum;
}

function locatorForRange(block: BookTextBlock, start: number, end: number) {
  if (block.locator.format !== 'pdf') return block.locator;
  const base = block.locator.textRange?.start ?? 0;
  return {
    ...block.locator,
    textRange: { start: base + start, end: base + end },
  };
}

export class BookChunker {
  chunk(
    book: Book,
    blocks: BookTextBlock[],
    signal?: AbortSignal,
  ): BookChunk[] {
    const chunks: BookChunk[] = [];
    for (const block of blocks) {
      throwIfBookIndexingAborted(signal);
      let start = 0;
      while (start < block.text.length) {
        throwIfBookIndexingAborted(signal);
        const end = findChunkEnd(block.text, start);
        const raw = block.text.slice(start, end);
        const leadingWhitespace = raw.length - raw.trimStart().length;
        const trailingWhitespace = raw.length - raw.trimEnd().length;
        const textStart = start + leadingWhitespace;
        const textEnd = end - trailingWhitespace;
        const text = block.text.slice(textStart, textEnd);
        if (text) {
          const ordinal = chunks.length;
          chunks.push(
            bookChunkSchema.parse({
              schemaVersion: 1,
              id: `chunk-${hashAgentText(
                `${book.id}:${book.fileHash}:${String(block.ordinal)}:${String(textStart)}:${String(textEnd)}`,
              ).slice(6)}`,
              bookId: book.id,
              sourceFileHash: book.fileHash,
              chapterHref: block.chapterHref,
              chapterTitle: block.chapterTitle,
              startLocator: locatorForRange(block, textStart, textEnd),
              endLocator: null,
              text,
              textHash: hashAgentText(text),
              estimatedTokens: Math.max(1, Math.ceil(text.length / 2)),
              ordinal,
            }),
          );
        }
        if (end >= block.text.length) break;
        start = Math.max(start + 1, end - overlapChars);
      }
    }
    return chunks;
  }
}
