import { useState } from 'react';

import { Button } from '../../../components/ui/button';
import { useI18n } from '../../../i18n/use-i18n';
import type { AcquisitionReport } from '../domain/acquisition-report';

/** One acquisition's acceptance summary, with the full report copyable. */
export function ReportSummary({ report }: { report: AcquisitionReport }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const { errors, warnings } = report.validation;
  return (
    <div className="text-muted-foreground mt-1 grid gap-1 text-xs">
      <p>
        {t('discovery.reportSummary', {
          built: report.builtChapters,
          expected: report.expectedChapters,
          pages: report.pagesFetched,
          embedded: report.images.embedded,
          images: report.images.total,
        })}
        {' · '}
        <span className={errors.length ? 'text-destructive' : undefined}>
          {errors.length
            ? t('discovery.reportInvalid', { count: errors.length })
            : t('discovery.reportValid')}
        </span>
        {warnings.length
          ? ` · ${t('discovery.reportWarnings', { count: warnings.length })}`
          : null}
      </p>
      {report.shortChapters.length ? (
        <p>
          {t('discovery.reportShort', {
            titles: report.shortChapters.join('、'),
          })}
        </p>
      ) : null}
      <div>
        <Button
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => {
            void navigator.clipboard
              .writeText(JSON.stringify(report, null, 2))
              .then(() => {
                setCopied(true);
              })
              .catch(() => {
                setCopied(false);
              });
          }}
        >
          {copied ? t('discovery.reportCopied') : t('discovery.copyReport')}
        </Button>
      </div>
    </div>
  );
}
