import type { ReadingSession } from '../../reader/domain/reading-activity';
import { translate } from '../../../i18n/i18n';

const DAY = 24 * 60 * 60 * 1000;

/** Local calendar date as `YYYY-MM-DD`; sessions count on the day they start. */
export function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(date.getFullYear())}-${month}-${day}`;
}

function startOfLocalDay(timestamp: number): Date {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Sums reading seconds per local day. */
export function dailyReadingTotals(
  sessions: readonly ReadingSession[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const session of sessions) {
    if (session.durationSeconds <= 0) continue;
    const key = localDayKey(session.startedAt);
    totals.set(key, (totals.get(key) ?? 0) + session.durationSeconds);
  }
  return totals;
}

export interface HeatmapDay {
  date: string;
  /** 0 = no reading, 4 = most reading relative to the busiest day. */
  level: 0 | 1 | 2 | 3 | 4;
  seconds: number;
}

/**
 * Builds week columns (Monday first) ending with the week of `now`. Days after
 * today are omitted so the last column may be shorter than seven days.
 */
export function buildReadingHeatmap(
  totals: ReadonlyMap<string, number>,
  now: number,
  weeks = 26,
): HeatmapDay[][] {
  const today = startOfLocalDay(now);
  const mondayOffset = (today.getDay() + 6) % 7;
  const start = addDays(today, -mondayOffset - (weeks - 1) * 7);
  const days: Omit<HeatmapDay, 'level'>[] = [];
  for (let date = start; date <= today; date = addDays(date, 1)) {
    const key = localDayKey(date.getTime());
    days.push({ date: key, seconds: totals.get(key) ?? 0 });
  }
  const busiest = Math.max(0, ...days.map((day) => day.seconds));
  const columns: HeatmapDay[][] = [];
  days.forEach((day, index) => {
    const level =
      day.seconds === 0 || busiest === 0
        ? 0
        : (Math.min(4, Math.ceil((day.seconds / busiest) * 4)) as
            1 | 2 | 3 | 4);
    const column = Math.floor(index / 7);
    (columns[column] ??= []).push({ ...day, level });
  });
  return columns;
}

/**
 * Consecutive days, ending today or yesterday, with at least `minimumSeconds`
 * of reading. Not having read yet today does not break the streak.
 */
export function readingStreak(
  totals: ReadonlyMap<string, number>,
  now: number,
  minimumSeconds = 1,
): number {
  let day = startOfLocalDay(now);
  const meets = (date: Date) =>
    (totals.get(localDayKey(date.getTime())) ?? 0) >= minimumSeconds;
  if (!meets(day)) day = addDays(day, -1);
  let streak = 0;
  while (meets(day)) {
    streak += 1;
    day = addDays(day, -1);
  }
  return streak;
}

/** Earliest timestamp the heatmap needs, for bounded session queries. */
export function heatmapStart(now: number, weeks = 26): number {
  return startOfLocalDay(now).getTime() - (weeks * 7 + 7) * DAY;
}

/** Formats seconds as hours and minutes in the active language. */
export function formatReadingDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return translate('stats.durationMinutes', { minutes });
  return translate('stats.durationHours', { hours, minutes });
}
