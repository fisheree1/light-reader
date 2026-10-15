import { useMemo } from 'react';

import { Button } from '../../../components/ui/button';
import type { ReaderTextSelection } from '../../../reader-engines/types';
import {
  selectionAiActionLabel,
  selectionAiActionSchema,
  type SelectionAiAction,
} from '../domain/agent';
import type { AiAssistantForm } from '../hooks/ai-assistant-reducer';
import { detectSensitiveContent } from '../services/sensitive-content';
import { useI18n } from '../../../i18n/use-i18n';

interface AiAssistantConsentFormProps {
  bookTitle: string;
  form: AiAssistantForm;
  indexNotice: string | null;
  model: string | null;
  onCancel: () => void;
  onChange: (patch: Partial<AiAssistantForm>) => void;
  onRebuildIndex: () => void;
  onSend: () => void;
  selection: ReaderTextSelection | null;
}

/** Shows exactly what will be sent to the local model and asks to send it. */
export function AiAssistantConsentForm({
  bookTitle,
  form,
  indexNotice,
  model,
  onCancel,
  onChange,
  onRebuildIndex,
  onSend,
  selection,
}: AiAssistantConsentFormProps) {
  const { t } = useI18n();
  const { action, customInstruction, mode, question, text } = form;
  const warnings = useMemo(() => detectSensitiveContent(text), [text]);
  const canSend =
    mode === 'book'
      ? question.trim().length >= 2
      : selection !== null &&
        text.trim().length > 0 &&
        (action !== 'custom' || customInstruction.trim().length > 0);

  return (
    <div className="mt-5 space-y-4">
      <div aria-label={t('aiConsent.scope')} className="grid grid-cols-2 gap-2">
        <Button
          onClick={() => {
            onChange({ mode: 'book' });
          }}
          variant={mode === 'book' ? 'default' : 'secondary'}
        >
          {t('aiConsent.bookQa')}
        </Button>
        <Button
          onClick={() => {
            onChange({ mode: 'selection' });
          }}
          variant={mode === 'selection' ? 'default' : 'secondary'}
        >
          {t('aiConsent.selection')}
        </Button>
      </div>

      <div className="rounded-md border p-3 text-sm">
        <p>
          <span className="font-medium">{t('aiConsent.source')}</span>
          {t('aiConsent.bookTitle', { title: bookTitle })}
        </p>
        {mode === 'selection' && selection ? (
          <p className="text-muted-foreground mt-1">
            {selection.locator.format === 'pdf'
              ? t('aiConsent.pdfPage', {
                  page: selection.locator.pageIndex + 1,
                })
              : t('aiConsent.epubSelection')}
          </p>
        ) : null}
        <p className="text-muted-foreground mt-1">
          {t('aiConsent.provider')}
          {model ?? t('aiConsent.notConfigured')}
        </p>
      </div>

      {mode === 'book' ? (
        <>
          <label className="block text-sm font-medium">
            {t('aiConsent.question')}
            <textarea
              aria-label={t('aiConsent.question')}
              autoFocus
              className="bg-background mt-2 min-h-32 w-full rounded-md border px-3 py-2 text-sm"
              maxLength={1_000}
              onChange={(event) => {
                onChange({ question: event.currentTarget.value });
              }}
              placeholder={t('aiConsent.questionPlaceholder')}
              value={question}
            />
          </label>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {t('aiConsent.indexHint')}
          </p>
          {indexNotice ? (
            <p className="text-sm" role="status">
              {indexNotice}
            </p>
          ) : null}
          <Button onClick={onRebuildIndex} variant="secondary">
            {t('aiConsent.rebuildIndex')}
          </Button>
        </>
      ) : selection ? (
        <>
          <label className="block text-sm font-medium">
            {t('aiConsent.task')}
            <select
              className="bg-background mt-2 w-full rounded-md border px-3 py-2"
              onChange={(event) => {
                onChange({
                  action: event.currentTarget.value as SelectionAiAction,
                });
              }}
              value={action}
            >
              {selectionAiActionSchema.options.map((value) => (
                <option key={value} value={value}>
                  {selectionAiActionLabel(value)}
                </option>
              ))}
            </select>
          </label>

          {action === 'custom' ? (
            <label className="block text-sm font-medium">
              {t('aiConsent.customInstruction')}
              <textarea
                aria-label={t('aiConsent.customInstruction')}
                autoFocus
                className="bg-background mt-2 min-h-28 w-full rounded-md border px-3 py-2 text-sm"
                maxLength={1_000}
                onChange={(event) => {
                  onChange({ customInstruction: event.currentTarget.value });
                }}
                placeholder={t('aiConsent.customPlaceholder')}
                value={customInstruction}
              />
              <span className="text-muted-foreground mt-1 block text-xs">
                {t('aiConsent.characterCount', {
                  count: customInstruction.length,
                  max: 1000,
                })}
              </span>
            </label>
          ) : null}

          <label className="block text-sm font-medium">
            {t('aiConsent.exactText')}
            <textarea
              className="bg-background mt-2 min-h-40 w-full rounded-md border px-3 py-2 font-mono text-sm"
              maxLength={12_000}
              onChange={(event) => {
                onChange({ text: event.currentTarget.value });
              }}
              value={text}
            />
          </label>
          <p className="text-muted-foreground text-xs">
            {t('aiConsent.textHint', { count: text.length, max: 12000 })}
          </p>

          {warnings.length ? (
            <div
              className="border-destructive/40 rounded-md border p-3 text-sm"
              role="alert"
            >
              <p className="font-medium">{t('aiConsent.sensitiveTitle')}</p>
              <ul className="mt-1 list-disc pl-5">
                {warnings.map((warning) => (
                  <li key={warning.kind}>{warning.label}</li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-1 text-xs">
                {t('aiConsent.sensitiveHint')}
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <div className="rounded-md border p-3 text-sm">
          {t('aiConsent.noSelection')}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button onClick={onCancel} variant="secondary">
          {t('common.cancel')}
        </Button>
        <Button disabled={!canSend} onClick={onSend}>
          {mode === 'book' ? t('aiConsent.askBook') : t('aiConsent.send')}
        </Button>
      </div>
    </div>
  );
}
