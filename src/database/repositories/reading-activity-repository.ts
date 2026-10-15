import type {
  BookReadingTotal,
  ReadingHistoryEntry,
  ReadingSession,
  ReadingStats,
} from '../../features/reader/domain/reading-activity';

export interface ReadingActivityRepository {
  finishSession(id: string, endedAt: number): Promise<ReadingSession>;
  getStats(): Promise<ReadingStats>;
  /** Reading time per book that still exists, most read first. */
  listBookTotals(limit?: number): Promise<BookReadingTotal[]>;
  listRecent(limit?: number): Promise<ReadingHistoryEntry[]>;
  /** Sessions that started at or after `since`, oldest first. */
  listSessionsSince(since: number): Promise<ReadingSession[]>;
  startSession(session: ReadingSession): Promise<ReadingSession>;
}
