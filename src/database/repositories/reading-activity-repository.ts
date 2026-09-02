import type {
  ReadingHistoryEntry,
  ReadingSession,
  ReadingStats,
} from '../../features/reader/domain/reading-activity';

export interface ReadingActivityRepository {
  finishSession(id: string, endedAt: number): Promise<ReadingSession>;
  getStats(): Promise<ReadingStats>;
  listRecent(limit?: number): Promise<ReadingHistoryEntry[]>;
  startSession(session: ReadingSession): Promise<ReadingSession>;
}
