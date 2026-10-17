export type ReadingStatus = 'unread' | 'reading' | 'finished';

/**
 * Progress at which a book counts as finished. Paginated readers rarely report
 * exactly 1 on the last page, so the last couple of percent count.
 */
export const FINISHED_PROGRESS = 0.98;

export function readingStatus(book: {
  lastReadAt: number | null;
  progress: number | null;
}): ReadingStatus {
  if (book.lastReadAt === null) return 'unread';
  return (book.progress ?? 0) >= FINISHED_PROGRESS ? 'finished' : 'reading';
}
