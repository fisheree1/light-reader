import { Copy, FilePlus2, Square } from 'lucide-react';

import { Button } from '../../../components/ui/button';
import type { BookLocator } from '../../../reader-engines/types';
import type { AgentToolTraceEntry } from '../domain/agent-tool';
import type { AiDraft } from '../domain/agent';
import type { BookIndexingProgress } from '../retrieval/book-indexing';
import { translate, type MessageKey } from '../../../i18n/i18n';
import { useI18n } from '../../../i18n/use-i18n';

const indexingStageLabels: Record<BookIndexingProgress['stage'], MessageKey> = {
  'reading-source': 'aiStatus.readingSource',
  'extracting-text': 'aiStatus.extractingText',
  'chunking-text': 'aiStatus.chunkingText',
  'writing-index': 'aiStatus.writingIndex',
  'searching-index': 'aiStatus.searchingIndex',
  ready: 'aiStatus.ready',
};

function getProgressLabel(progress: BookIndexingProgress | null): string {
  if (!progress) return translate('aiStatus.preparing');
  const suffix =
    progress.completed !== null && progress.total !== null
      ? ` ${String(progress.completed)} / ${String(progress.total)}`
      : '';
  return `${translate(indexingStageLabels[progress.stage])}${suffix}`;
}

export function AiRunningStatus({
  mode,
  onCancel,
  output,
  progress,
}: {
  mode: 'book' | 'selection';
  onCancel: () => void;
  output: string;
  progress: BookIndexingProgress | null;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-5">
      <p aria-live="polite" className="text-sm font-medium">
        {mode === 'book'
          ? output
            ? t('aiStatus.answering')
            : getProgressLabel(progress)
          : t('aiStatus.generating')}
      </p>
      <pre className="bg-background mt-3 min-h-40 rounded-md border p-4 font-sans text-sm whitespace-pre-wrap">
        {output || t('aiStatus.waiting')}
      </pre>
      <div className="mt-4 flex justify-end">
        <Button onClick={onCancel} variant="secondary">
          <Square aria-hidden="true" size={15} />
          {t('aiStatus.stop')}
        </Button>
      </div>
    </div>
  );
}

export function AiRebuildingStatus({
  onCancel,
  progress,
}: {
  onCancel: () => void;
  progress: BookIndexingProgress | null;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-5 rounded-md border p-4">
      <p aria-live="polite" className="text-sm font-medium">
        {getProgressLabel(progress)}
      </p>
      <p className="text-muted-foreground mt-2 text-xs">
        {t('aiStatus.rebuildHint')}
      </p>
      <Button className="mt-4" onClick={onCancel} variant="secondary">
        <Square aria-hidden="true" size={15} />
        {t('aiStatus.cancelRebuild')}
      </Button>
    </div>
  );
}

export function AiCancelledStatus({
  operation,
  onRestart,
}: {
  operation: 'answer' | 'rebuild';
  onRestart: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-5 rounded-md border p-4">
      <p className="font-medium">
        {operation === 'rebuild'
          ? t('aiStatus.rebuildCancelled')
          : t('aiStatus.generationCancelled')}
      </p>
      <p className="text-muted-foreground mt-1 text-sm">
        {operation === 'rebuild'
          ? t('aiStatus.indexKept')
          : t('aiStatus.nothingWritten')}
      </p>
      <Button className="mt-4" onClick={onRestart}>
        {t('aiStatus.restart')}
      </Button>
    </div>
  );
}

export function AiErrorStatus({
  error,
  onBack,
}: {
  error: string | null;
  onBack: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-5 rounded-md border p-4" role="alert">
      <p className="font-medium">{t('aiStatus.failed')}</p>
      <p className="text-destructive mt-1 text-sm">{error}</p>
      <Button className="mt-4" onClick={onBack}>
        {t('aiStatus.backToPreview')}
      </Button>
    </div>
  );
}

interface AiDraftResultProps {
  bookTitle: string;
  copied: boolean;
  draft: AiDraft;
  isCreatingNote: boolean;
  onClose: () => void;
  onCopy: () => void;
  onCreateNote: () => void;
  onNavigate?: (locator: BookLocator) => void;
  trace: AgentToolTraceEntry[];
}

export function AiDraftResult({
  bookTitle,
  copied,
  draft,
  isCreatingNote,
  onClose,
  onCopy,
  onCreateNote,
  onNavigate,
  trace,
}: AiDraftResultProps) {
  const { t } = useI18n();
  return (
    <div className="mt-5">
      <p aria-live="polite" className="text-sm font-medium">
        {t('aiStatus.draftReady')}
      </p>
      <pre className="bg-background mt-3 max-h-80 overflow-auto rounded-md border p-4 font-sans text-sm whitespace-pre-wrap">
        {draft.content}
      </pre>
      <p className="text-muted-foreground mt-2 text-xs">
        {t('aiStatus.generatedBy', { model: draft.model })}
      </p>
      {draft.citations.length ? (
        <div className="mt-4">
          <p className="text-xs font-medium">{t('aiStatus.evidence')}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('aiStatus.evidenceHint')}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {draft.citations.map((citation, index) => (
              <Button
                key={citation.id}
                onClick={() => onNavigate?.(citation.locator)}
                variant="secondary"
              >
                {t('aiStatus.citation', {
                  number: index + 1,
                  place:
                    citation.locator.format === 'pdf'
                      ? t('aiStatus.page', {
                          page: citation.locator.pageIndex + 1,
                        })
                      : (citation.chapterTitleSnapshot ??
                        t('aiStatus.chapter')),
                })}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      {trace.length ? (
        <details className="mt-4 rounded-md border p-3 text-xs">
          <summary className="cursor-pointer font-medium">
            {t('aiStatus.runDetails')}
          </summary>
          <p className="text-muted-foreground mt-2">
            {t('aiStatus.scope', { title: bookTitle, count: trace.length })}
          </p>
          <ul className="mt-2 space-y-1">
            {trace.map((item) => (
              <li key={item.callId}>
                {t('aiStatus.toolLine', {
                  tool:
                    item.name === 'search_books'
                      ? t('aiStatus.toolSearch')
                      : t('aiStatus.toolRead'),
                  status:
                    item.status === 'completed'
                      ? t('aiStatus.toolCompleted', {
                          count: item.returnedChars,
                        })
                      : item.status === 'rejected'
                        ? t('aiStatus.toolRejected')
                        : t('aiStatus.toolFailed'),
                })}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button onClick={onClose} variant="secondary">
          {t('aiStatus.discard')}
        </Button>
        <Button onClick={onCopy} variant="secondary">
          <Copy aria-hidden="true" size={15} />
          {copied ? t('aiStatus.copied') : t('aiStatus.copy')}
        </Button>
        <Button disabled={isCreatingNote} onClick={onCreateNote}>
          <FilePlus2 aria-hidden="true" size={15} />
          {isCreatingNote
            ? t('aiStatus.creatingNote')
            : t('aiStatus.createNote')}
        </Button>
      </div>
    </div>
  );
}
