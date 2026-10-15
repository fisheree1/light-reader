import { cn } from '../../../lib/cn';
import {
  formatReadingDuration,
  type HeatmapDay,
} from '../domain/reading-stats';

const levelClasses = [
  'bg-muted',
  'bg-primary/25',
  'bg-primary/50',
  'bg-primary/75',
  'bg-primary',
] as const;

interface ReadingHeatmapProps {
  columns: HeatmapDay[][];
}

/** Calendar heatmap of daily reading time, one column per week. */
export function ReadingHeatmap({ columns }: ReadingHeatmapProps) {
  const days = columns.flat();
  const activeDays = days.filter((day) => day.seconds > 0).length;

  return (
    <figure className="mt-4">
      <div
        aria-label={`过去 ${String(columns.length)} 周中有 ${String(activeDays)} 天阅读`}
        className="flex gap-1 overflow-x-auto pb-1"
        role="img"
      >
        {columns.map((week) => (
          <div className="flex flex-col gap-1" key={week[0]?.date}>
            {week.map((day) => (
              <span
                className={cn('size-3 rounded-sm', levelClasses[day.level])}
                data-date={day.date}
                data-level={day.level}
                key={day.date}
                title={`${day.date}：${
                  day.seconds > 0
                    ? formatReadingDuration(day.seconds)
                    : '未阅读'
                }`}
              />
            ))}
          </div>
        ))}
      </div>
      <figcaption className="text-muted-foreground mt-2 flex items-center gap-1 text-xs">
        少
        {levelClasses.map((className) => (
          <span
            aria-hidden="true"
            className={cn('size-3 rounded-sm', className)}
            key={className}
          />
        ))}
        多
      </figcaption>
    </figure>
  );
}
