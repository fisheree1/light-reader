import { BarChart3, Flame, Target } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { EmptyState } from '../../components/common/empty-state';
import { Button } from '../../components/ui/button';
import { AppError } from '../../lib/app-error';
import { ReadingHeatmap } from './components/reading-heatmap';
import {
  buildReadingHeatmap,
  dailyReadingTotals,
  formatReadingDuration,
  localDayKey,
  readingStreak,
} from './domain/reading-stats';
import {
  useReadingStats,
  type ReadingStatsData,
} from './hooks/use-reading-stats';
import {
  statsServices as defaultStatsServices,
  type StatsServices,
} from './services/stats-services';
import { useI18n } from '../../i18n/use-i18n';

interface StatsPageProps {
  now?: number;
  services?: StatsServices;
}

export function StatsPage({
  now: fixedNow,
  services = defaultStatsServices,
}: StatsPageProps) {
  const { t } = useI18n();
  const [now] = useState(() => fixedNow ?? Date.now());
  const { state, saveGoal, reload } = useReadingStats(services, now);

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <h1 className="text-2xl font-semibold">{t('stats.title')}</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        {t('stats.description')}
      </p>

      {state.status === 'loading' ? (
        <p aria-live="polite" className="mt-8 text-sm">
          {t('stats.loading')}
        </p>
      ) : null}

      {state.status === 'error' ? (
        <div className="mt-8 rounded-md border p-4" role="alert">
          <p className="text-sm">{state.message}</p>
          <Button className="mt-3" onClick={reload} variant="secondary">
            {t('common.retry')}
          </Button>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        state.data.stats.sessionCount === 0 ? (
          <div className="mt-8">
            <EmptyState
              action={
                <Button asChild>
                  <Link to="/library">{t('stats.startReading')}</Link>
                </Button>
              }
              description={t('stats.emptyDescription')}
              icon={<BarChart3 aria-hidden="true" size={28} />}
              title={t('stats.emptyTitle')}
            />
          </div>
        ) : (
          <StatsContent data={state.data} now={now} onSaveGoal={saveGoal} />
        )
      ) : null}
    </div>
  );
}

interface StatsContentProps {
  data: ReadingStatsData;
  now: number;
  onSaveGoal: (dailyMinutes: number | null) => Promise<void>;
}

function StatsContent({ data, now, onSaveGoal }: StatsContentProps) {
  const { formatDate, t } = useI18n();
  const totals = useMemo(
    () => dailyReadingTotals(data.sessions),
    [data.sessions],
  );
  const heatmap = useMemo(
    () => buildReadingHeatmap(totals, now),
    [totals, now],
  );
  const goalSeconds = (data.goal.dailyMinutes ?? 0) * 60;
  const todaySeconds = totals.get(localDayKey(now)) ?? 0;
  const streak = readingStreak(totals, now, Math.max(1, goalSeconds));
  const busiestBook = Math.max(
    1,
    ...data.bookTotals.map((book) => book.totalSeconds),
  );

  return (
    <>
      <section
        aria-label={t('stats.overview')}
        className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <SummaryCard
          label={t('stats.totalTime')}
          value={formatReadingDuration(data.stats.totalSeconds)}
        />
        <SummaryCard
          label={t('stats.sessions')}
          value={String(data.stats.sessionCount)}
        />
        <SummaryCard
          label={t('stats.booksRead')}
          value={String(data.stats.booksRead)}
        />
        <SummaryCard
          icon={<Flame aria-hidden="true" size={16} />}
          label={goalSeconds ? t('stats.goalStreak') : t('stats.streak')}
          value={t('stats.days', { count: streak })}
        />
      </section>

      <GoalSection
        goalMinutes={data.goal.dailyMinutes}
        onSave={onSaveGoal}
        todaySeconds={todaySeconds}
      />

      <section className="bg-surface mt-4 rounded-lg border p-5">
        <h2 className="font-medium">{t('stats.heatmap')}</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          {t('stats.heatmapDescription')}
        </p>
        <ReadingHeatmap columns={heatmap} />
      </section>

      <section className="bg-surface mt-4 rounded-lg border p-5">
        <h2 className="font-medium">{t('stats.perBook')}</h2>
        {data.bookTotals.length ? (
          <ol className="mt-3 space-y-3">
            {data.bookTotals.map((book) => (
              <li key={book.bookId}>
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <Link
                    className="truncate font-medium hover:underline"
                    to={`/reader/${encodeURIComponent(book.bookId)}`}
                  >
                    {book.bookTitle}
                    <span className="text-muted-foreground ml-2 font-normal">
                      {book.author ?? t('common.unknownAuthor')}
                    </span>
                  </Link>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {t('stats.bookTotal', {
                      duration: formatReadingDuration(book.totalSeconds),
                      count: book.sessionCount,
                    })}
                  </span>
                </div>
                <div aria-hidden="true" className="bg-muted mt-1 h-1.5 rounded">
                  <div
                    className="bg-primary h-full rounded"
                    style={{
                      width: `${String(
                        Math.max(2, (book.totalSeconds / busiestBook) * 100),
                      )}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted-foreground mt-2 text-sm">
            {t('stats.noBookTime')}
          </p>
        )}
      </section>

      <section className="bg-surface mt-4 rounded-lg border p-5">
        <h2 className="font-medium">{t('stats.recent')}</h2>
        {data.recent.length ? (
          <ol className="mt-2 divide-y rounded-md border">
            {data.recent.map((entry, index) => (
              <li
                className="flex items-center justify-between gap-4 p-3 text-sm"
                key={`${entry.bookId}-${String(entry.startedAt)}-${String(index)}`}
              >
                <span className="truncate">{entry.bookTitle}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {t('stats.recentEntry', {
                    date: formatDate(entry.startedAt),
                    minutes: Math.max(
                      1,
                      Math.round(entry.durationSeconds / 60),
                    ),
                  })}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted-foreground mt-2 text-sm">
            {t('stats.noHistory')}
          </p>
        )}
      </section>
    </>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-surface rounded-lg border p-4">
      <p className="text-muted-foreground flex items-center gap-1 text-xs">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

interface GoalSectionProps {
  goalMinutes: number | null;
  onSave: (dailyMinutes: number | null) => Promise<void>;
  todaySeconds: number;
}

function GoalSection({ goalMinutes, onSave, todaySeconds }: GoalSectionProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(String(goalMinutes ?? 30));
  const [status, setStatus] = useState<
    { kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const todayMinutes = Math.floor(todaySeconds / 60);
  const progress = goalMinutes
    ? Math.min(100, (todaySeconds / (goalMinutes * 60)) * 100)
    : 0;
  const draftValue = Number(draft);
  const validDraft =
    Number.isInteger(draftValue) && draftValue >= 5 && draftValue <= 600;

  async function save(dailyMinutes: number | null) {
    setStatus({ kind: 'saving' });
    try {
      await onSave(dailyMinutes);
      setStatus({ kind: 'saved' });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: new AppError('READING_GOAL_WRITE_FAILED', { cause: error })
          .userMessage,
      });
    }
  }

  return (
    <section
      aria-labelledby="reading-goal-title"
      className="bg-surface mt-4 rounded-lg border p-5"
    >
      <h2
        className="flex items-center gap-2 font-medium"
        id="reading-goal-title"
      >
        <Target aria-hidden="true" size={17} />
        {t('stats.goalTitle')}
      </h2>
      {goalMinutes ? (
        <div className="mt-3">
          <p className="text-sm">
            {t('stats.todayProgress', {
              read: todayMinutes,
              goal: goalMinutes,
            })}
            {progress >= 100 ? t('stats.goalReached') : ''}
          </p>
          <div
            aria-label={t('stats.goalProgress')}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(progress)}
            className="bg-muted mt-2 h-2 rounded"
            role="progressbar"
          >
            <div
              className="bg-primary h-full rounded"
              style={{ width: `${String(progress)}%` }}
            />
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground mt-2 text-sm">
          {t('stats.noGoal')}
        </p>
      )}
      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (validDraft) void save(draftValue);
        }}
      >
        <label className="text-sm font-medium">
          {t('stats.dailyMinutes')}
          <input
            className="bg-background mt-1 block w-28 rounded-md border px-3 py-2 text-sm"
            max={600}
            min={5}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              setStatus({ kind: 'idle' });
            }}
            step={5}
            type="number"
            value={draft}
          />
        </label>
        <Button
          disabled={!validDraft || status.kind === 'saving'}
          type="submit"
        >
          {t('stats.saveGoal')}
        </Button>
        {goalMinutes ? (
          <Button
            disabled={status.kind === 'saving'}
            onClick={() => void save(null)}
            type="button"
            variant="secondary"
          >
            {t('stats.clearGoal')}
          </Button>
        ) : null}
        <span aria-live="polite" className="text-muted-foreground text-sm">
          {status.kind === 'saved' ? t('stats.goalSaved') : null}
          {status.kind === 'error' ? status.message : null}
          {!validDraft ? t('stats.goalInvalid') : null}
        </span>
      </form>
    </section>
  );
}
