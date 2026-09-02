import { z } from 'zod';

export const readingSessionSchema = z.object({
  id: z.string().trim().min(1).max(128),
  bookId: z.string().trim().min(1).max(128),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().nullable(),
  durationSeconds: z.number().int().nonnegative(),
});

export const readingHistoryEntrySchema = z.object({
  bookId: z.string().trim().min(1).max(128),
  bookTitle: z.string().trim().min(1).max(500),
  author: z.string().nullable(),
  startedAt: z.number().int().nonnegative(),
  durationSeconds: z.number().int().nonnegative(),
});

export const readingStatsSchema = z.object({
  totalSeconds: z.number().int().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
  booksRead: z.number().int().nonnegative(),
  lastReadAt: z.number().int().nonnegative().nullable(),
});

export type ReadingSession = z.infer<typeof readingSessionSchema>;
export type ReadingHistoryEntry = z.infer<typeof readingHistoryEntrySchema>;
export type ReadingStats = z.infer<typeof readingStatsSchema>;
