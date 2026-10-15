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

interface StatsPageProps {
  now?: number;
  services?: StatsServices;
}

export function StatsPage({
  now: fixedNow,
  services = defaultStatsServices,
}: StatsPageProps) {
  const [now] = useState(() => fixedNow ?? Date.now());
  const { state, saveGoal, reload } = useReadingStats(services, now);

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <h1 className="text-2xl font-semibold">阅读统计</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        阅读时长只在本机记录，用于热力图、每本书的阅读时间和每日目标。
      </p>

      {state.status === 'loading' ? (
        <p aria-live="polite" className="mt-8 text-sm">
          正在加载阅读统计…
        </p>
      ) : null}

      {state.status === 'error' ? (
        <div className="mt-8 rounded-md border p-4" role="alert">
          <p className="text-sm">{state.message}</p>
          <Button className="mt-3" onClick={reload} variant="secondary">
            重试
          </Button>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        state.data.stats.sessionCount === 0 ? (
          <div className="mt-8">
            <EmptyState
              action={
                <Button asChild>
                  <Link to="/library">去书架开始阅读</Link>
                </Button>
              }
              description="打开任意一本书阅读后，这里会显示阅读时长与热力图。"
              icon={<BarChart3 aria-hidden="true" size={28} />}
              title="还没有阅读记录"
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
        aria-label="阅读概览"
        className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <SummaryCard
          label="累计阅读"
          value={formatReadingDuration(data.stats.totalSeconds)}
        />
        <SummaryCard label="阅读次数" value={String(data.stats.sessionCount)} />
        <SummaryCard label="读过的书" value={String(data.stats.booksRead)} />
        <SummaryCard
          icon={<Flame aria-hidden="true" size={16} />}
          label={goalSeconds ? '连续达标' : '连续阅读'}
          value={`${String(streak)} 天`}
        />
      </section>

      <GoalSection
        goalMinutes={data.goal.dailyMinutes}
        onSave={onSaveGoal}
        todaySeconds={todaySeconds}
      />

      <section className="bg-surface mt-4 rounded-lg border p-5">
        <h2 className="font-medium">阅读热力图</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          最近 26 周，每格代表一天，颜色越深读得越久。
        </p>
        <ReadingHeatmap columns={heatmap} />
      </section>

      <section className="bg-surface mt-4 rounded-lg border p-5">
        <h2 className="font-medium">每本书的阅读时长</h2>
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
                      {book.author ?? '未知作者'}
                    </span>
                  </Link>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {formatReadingDuration(book.totalSeconds)} ·{' '}
                    {String(book.sessionCount)} 次
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
            书架上的书还没有阅读时长。
          </p>
        )}
      </section>

      <section className="bg-surface mt-4 rounded-lg border p-5">
        <h2 className="font-medium">最近阅读</h2>
        {data.recent.length ? (
          <ol className="mt-2 divide-y rounded-md border">
            {data.recent.map((entry, index) => (
              <li
                className="flex items-center justify-between gap-4 p-3 text-sm"
                key={`${entry.bookId}-${String(entry.startedAt)}-${String(index)}`}
              >
                <span className="truncate">{entry.bookTitle}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {new Date(entry.startedAt).toLocaleString('zh-CN')} ·{' '}
                  {String(Math.max(1, Math.round(entry.durationSeconds / 60)))}{' '}
                  分钟
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted-foreground mt-2 text-sm">暂无阅读记录。</p>
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
        每日阅读目标
      </h2>
      {goalMinutes ? (
        <div className="mt-3">
          <p className="text-sm">
            今天已读 {String(todayMinutes)} / {String(goalMinutes)} 分钟
            {progress >= 100 ? '，已达成 🎉' : ''}
          </p>
          <div
            aria-label="今日目标进度"
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
          尚未设置目标。设置后会显示今日进度，连续天数也会按目标计算。
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
          每日分钟数
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
          保存目标
        </Button>
        {goalMinutes ? (
          <Button
            disabled={status.kind === 'saving'}
            onClick={() => void save(null)}
            type="button"
            variant="secondary"
          >
            取消目标
          </Button>
        ) : null}
        <span aria-live="polite" className="text-muted-foreground text-sm">
          {status.kind === 'saved' ? '阅读目标已保存' : null}
          {status.kind === 'error' ? status.message : null}
          {!validDraft ? '请输入 5–600 之间的整数' : null}
        </span>
      </form>
    </section>
  );
}
