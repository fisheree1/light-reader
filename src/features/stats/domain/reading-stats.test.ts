import type { ReadingSession } from '../../reader/domain/reading-activity';
import {
  buildReadingHeatmap,
  dailyReadingTotals,
  formatReadingDuration,
  heatmapStart,
  localDayKey,
  readingStreak,
} from './reading-stats';

function at(year: number, month: number, day: number, hour = 12) {
  return new Date(year, month - 1, day, hour).getTime();
}

function session(startedAt: number, durationSeconds: number): ReadingSession {
  return {
    id: `s-${String(startedAt)}`,
    bookId: 'book',
    startedAt,
    endedAt: startedAt + durationSeconds * 1000,
    durationSeconds,
  };
}

describe('reading stats', () => {
  it('groups session time by local start day', () => {
    const totals = dailyReadingTotals([
      session(at(2026, 10, 14, 23), 600),
      session(at(2026, 10, 14, 8), 60),
      session(at(2026, 10, 15, 0), 30),
      session(at(2026, 10, 15, 9), 0),
    ]);

    expect(Object.fromEntries(totals)).toEqual({
      '2026-10-14': 660,
      '2026-10-15': 30,
    });
    expect(localDayKey(at(2026, 1, 5))).toBe('2026-01-05');
  });

  it('builds Monday-first week columns ending today with relative levels', () => {
    const now = at(2026, 10, 15); // Thursday
    const totals = new Map([
      ['2026-10-12', 3600],
      ['2026-10-15', 900],
    ]);

    const columns = buildReadingHeatmap(totals, now, 2);

    expect(columns).toHaveLength(2);
    expect(columns[0]).toHaveLength(7);
    expect(columns[0]?.[0]?.date).toBe('2026-10-05');
    expect(columns[1]?.map((day) => day.date)).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
    ]);
    expect(columns[1]?.[0]).toMatchObject({ seconds: 3600, level: 4 });
    expect(columns[1]?.[3]).toMatchObject({ seconds: 900, level: 1 });
    expect(columns[1]?.[1]?.level).toBe(0);
  });

  it('counts streaks through yesterday and against a daily goal', () => {
    const now = at(2026, 10, 15);
    const totals = new Map([
      ['2026-10-12', 1200],
      ['2026-10-13', 300],
      ['2026-10-14', 1800],
    ]);

    expect(readingStreak(totals, now)).toBe(3);
    expect(readingStreak(totals, now, 600)).toBe(1);
    expect(readingStreak(new Map([['2026-10-15', 5]]), now)).toBe(1);
    expect(readingStreak(new Map(), now)).toBe(0);
  });

  it('formats durations and bounds heatmap queries', () => {
    expect(formatReadingDuration(59)).toBe('0 分钟');
    expect(formatReadingDuration(7_500)).toBe('2 小时 5 分钟');
    expect(heatmapStart(at(2026, 10, 15), 1)).toBeLessThan(at(2026, 10, 5));
  });
});
