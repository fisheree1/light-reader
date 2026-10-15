import { AlertTriangle, Highlighter } from 'lucide-react';

import { cn } from '../../../lib/cn';
import type { Annotation, AnnotationColor } from '../domain/annotation';
import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import type { AnnotationExportFormat } from '../services/annotation-export-service';
import { useI18n } from '../../../i18n/use-i18n';

const colorClasses: Record<AnnotationColor, string> = {
  yellow: 'bg-yellow-400',
  blue: 'bg-blue-400',
  green: 'bg-green-400',
  red: 'bg-red-400',
};

interface AnnotationSidebarProps {
  activeId: string | null;
  annotations: Annotation[];
  onSelect: (id: string) => void;
  onExport: (format: AnnotationExportFormat) => Promise<void>;
  unresolvedIds: string[];
}

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function AnnotationSidebar({
  activeId,
  annotations,
  onSelect,
  onExport,
  unresolvedIds,
}: AnnotationSidebarProps) {
  const { t } = useI18n();
  const [exportFormat, setExportFormat] =
    useState<AnnotationExportFormat>('markdown');
  const [exportStatus, setExportStatus] = useState('');
  return (
    <aside
      aria-label={t('annotations.sidebarTitle')}
      className="bg-surface w-72 shrink-0 overflow-auto border-l p-3"
    >
      <div className="mb-3 flex items-center gap-2 px-2">
        <Highlighter aria-hidden="true" size={16} />
        <h2 className="text-sm font-semibold">
          {t('annotations.sidebarTitle')}
        </h2>
        <span className="text-muted-foreground ml-auto text-xs tabular-nums">
          {annotations.length}
        </span>
      </div>
      <div className="mb-3 flex gap-2 px-2">
        <label className="sr-only" htmlFor="annotation-export-format">
          {t('annotations.exportFormat')}
        </label>
        <select
          className="bg-background h-8 min-w-0 flex-1 rounded border px-2 text-xs"
          id="annotation-export-format"
          onChange={(event) => {
            setExportFormat(
              event.currentTarget.value as AnnotationExportFormat,
            );
          }}
          value={exportFormat}
        >
          <option value="markdown">Markdown</option>
          <option value="json">JSON v1</option>
        </select>
        <Button
          disabled={annotations.length === 0}
          onClick={() => {
            setExportStatus(t('annotations.exporting'));
            void onExport(exportFormat).then(
              () => {
                setExportStatus(t('annotations.exported'));
              },
              () => {
                setExportStatus(t('annotations.exportFailed'));
              },
            );
          }}
          size="sm"
          variant="secondary"
        >
          {t('annotations.export')}
        </Button>
      </div>
      <p aria-live="polite" className="text-muted-foreground mb-2 px-2 text-xs">
        {exportStatus}
      </p>

      {annotations.length === 0 ? (
        <p className="text-muted-foreground px-2 py-8 text-center text-sm">
          {t('annotations.empty')}
        </p>
      ) : (
        <ol className="space-y-2">
          {annotations.map((annotation) => {
            const unresolved = unresolvedIds.includes(annotation.id);
            return (
              <li key={annotation.id}>
                <button
                  aria-current={
                    activeId === annotation.id ? 'location' : undefined
                  }
                  className={cn(
                    'hover:bg-muted focus-visible:bg-muted w-full rounded-lg border p-3 text-left transition-colors',
                    activeId === annotation.id && 'border-primary bg-muted',
                  )}
                  onClick={() => {
                    onSelect(annotation.id);
                  }}
                  type="button"
                >
                  <div className="flex items-center gap-2">
                    <span
                      aria-label={t('annotations.colorHighlight', {
                        color: annotation.color,
                      })}
                      className={cn(
                        'size-2.5 rounded-full',
                        colorClasses[annotation.color],
                      )}
                    />
                    <span className="text-muted-foreground truncate text-xs">
                      {annotation.chapterHref ??
                        t('annotations.unknownChapter')}
                    </span>
                    <time className="text-muted-foreground ml-auto text-[0.65rem]">
                      {dateFormatter.format(annotation.createdAt)}
                    </time>
                  </div>
                  <blockquote className="mt-2 line-clamp-3 text-sm leading-relaxed">
                    {annotation.text}
                  </blockquote>
                  {annotation.noteText ? (
                    <p className="text-muted-foreground mt-2 line-clamp-2 border-t pt-2 text-xs">
                      {annotation.noteText}
                    </p>
                  ) : null}
                  {unresolved ? (
                    <span className="text-destructive mt-2 flex items-center gap-1 text-xs">
                      <AlertTriangle aria-hidden="true" size={12} />
                      {t('annotations.unresolved')}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
