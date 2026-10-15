import { useCallback, useEffect, useState } from 'react';

import { AppError } from '../../../lib/app-error';
import type {
  BookReadingTotal,
  ReadingGoal,
  ReadingHistoryEntry,
  ReadingSession,
  ReadingStats,
} from '../../reader/domain/reading-activity';
import { heatmapStart } from '../domain/reading-stats';
import type { StatsServices } from '../services/stats-services';

export interface ReadingStatsData {
  bookTotals: BookReadingTotal[];
  goal: ReadingGoal;
  recent: ReadingHistoryEntry[];
  sessions: ReadingSession[];
  stats: ReadingStats;
}

export type ReadingStatsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ReadingStatsData };

export function useReadingStats(services: StatsServices, now: number) {
  const [state, setState] = useState<ReadingStatsState>({ status: 'loading' });
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const { activityRepository, goalRepository } = services;
    Promise.all([
      activityRepository.getStats(),
      activityRepository.listSessionsSince(heatmapStart(now)),
      activityRepository.listBookTotals(10),
      activityRepository.listRecent(10),
      goalRepository.get(),
    ]).then(
      ([stats, sessions, bookTotals, recent, goal]) => {
        if (!cancelled) {
          setState({
            status: 'ready',
            data: { bookTotals, goal, recent, sessions, stats },
          });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: new AppError('READING_STATS_FAILED', { cause: error })
              .userMessage,
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [services, now, reloadCount]);

  const saveGoal = useCallback(
    async (dailyMinutes: number | null) => {
      const goal = await services.goalRepository.save({
        schemaVersion: 1,
        dailyMinutes,
      });
      setState((current) =>
        current.status === 'ready'
          ? { status: 'ready', data: { ...current.data, goal } }
          : current,
      );
    },
    [services],
  );

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setReloadCount((count) => count + 1);
  }, []);

  return { state, saveGoal, reload };
}
