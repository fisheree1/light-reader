import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '../../../components/ui/button';
import { useI18n } from '../../../i18n/use-i18n';
import { ReportSummary } from '../components/report-summary';
import {
  cancelDownload,
  clearFinishedDownloads,
  isActive,
  useDownloads,
  type DownloadJob,
} from './download-queue';

function statusText(
  job: DownloadJob,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (job.message) return job.message;
  if (job.status === 'running')
    return job.progress
      ? `${t(`discovery.${job.progress.stage}`)} · ${String(job.progress.completed)}/${String(job.progress.total)}`
      : t('discovery.downloadStarting');
  if (job.status === 'queued') return t('discovery.downloadQueued');
  if (job.status === 'cancelled') return t('discovery.downloadCancelled');
  return t(`discovery.${job.status}`);
}

/**
 * The downloads of one panel (groups starting with `prefix`). They keep
 * running when this page is left; the list shows them again on return.
 */
export function DownloadList({ prefix }: { prefix: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const jobs = useDownloads(
    useShallow((state) =>
      state.jobs.filter((job) => job.group.startsWith(prefix)),
    ),
  );
  if (!jobs.length) return null;
  const finished = jobs.some((job) => !isActive(job));

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('discovery.downloads')}</h2>
        {finished ? (
          <Button
            className="h-7 px-2 text-xs"
            onClick={() => {
              clearFinishedDownloads(prefix);
            }}
            variant="ghost"
          >
            {t('discovery.clearFinished')}
          </Button>
        ) : null}
      </div>
      <ul aria-label={t('discovery.outcomes')} className="grid gap-2">
        {jobs.map((job) => (
          <li
            className="bg-surface flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 text-sm"
            key={job.id}
          >
            <div className="min-w-0">
              <p className="font-medium">{job.title}</p>
              <p
                className={
                  job.status === 'failed'
                    ? 'text-destructive'
                    : 'text-muted-foreground'
                }
              >
                {statusText(job, t)}
              </p>
              {job.missingImages ? (
                <p>
                  {t('discovery.missingImages', { count: job.missingImages })}
                </p>
              ) : null}
              {job.report ? <ReportSummary report={job.report} /> : null}
            </div>
            {isActive(job) ? (
              <Button
                onClick={() => {
                  cancelDownload(job.id);
                }}
                variant="secondary"
              >
                {t('discovery.cancelDownload')}
              </Button>
            ) : job.bookId ? (
              <Button
                onClick={() => {
                  void navigate(
                    `/reader/${encodeURIComponent(job.bookId ?? '')}`,
                  );
                }}
                variant="secondary"
              >
                {t('discovery.read')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
