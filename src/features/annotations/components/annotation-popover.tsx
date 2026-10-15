import { NotebookPen, Save, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import type { Annotation } from '../domain/annotation';
import { useI18n } from '../../../i18n/use-i18n';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface AnnotationPopoverProps {
  annotation: Annotation;
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
  onInsertIntoNote?: (id: string) => Promise<void>;
  onSave: (id: string, noteText: string) => Promise<Annotation>;
}

const autoSaveDelay = 650;

export function AnnotationPopover({
  annotation,
  onClose,
  onDelete,
  onInsertIntoNote,
  onSave,
}: AnnotationPopoverProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(annotation.noteText ?? '');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const [insertError, setInsertError] = useState(false);
  const [isInserting, setIsInserting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latestDraftRef = useRef(draft);
  const savedDraftRef = useRef(draft);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    return () => {
      clearTimeout(timerRef.current);
      if (latestDraftRef.current !== savedDraftRef.current) {
        void onSave(annotation.id, latestDraftRef.current).catch(
          () => undefined,
        );
      }
    };
  }, [annotation.id, onSave]);

  async function save(value = latestDraftRef.current): Promise<boolean> {
    clearTimeout(timerRef.current);
    setSaveStatus('saving');
    try {
      const updated = await onSave(annotation.id, value);
      savedDraftRef.current = updated.noteText ?? '';
      setSaveStatus('saved');
      return true;
    } catch {
      setSaveStatus('error');
      return false;
    }
  }

  function updateDraft(value: string) {
    setDraft(value);
    latestDraftRef.current = value;
    setSaveStatus('saving');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(value), autoSaveDelay);
  }

  async function handleClose() {
    if (
      latestDraftRef.current === savedDraftRef.current ||
      (await save(latestDraftRef.current))
    ) {
      onClose();
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await onDelete(annotation.id);
    } catch {
      setDeleteError(true);
      setConfirmDelete(false);
    }
  }

  async function handleInsertIntoNote() {
    if (!onInsertIntoNote || isInserting) return;
    setInsertError(false);
    setIsInserting(true);
    try {
      await onInsertIntoNote(annotation.id);
    } catch {
      setInsertError(true);
      setIsInserting(false);
    }
  }

  return (
    <section
      aria-label={t('annotations.popoverLabel')}
      aria-modal="false"
      className="bg-surface fixed top-16 right-4 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-xl border p-4 shadow-xl"
      role="dialog"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{t('annotations.popoverLabel')}</h2>
          <blockquote className="text-muted-foreground mt-2 line-clamp-4 border-l-2 pl-3 text-sm">
            {annotation.text}
          </blockquote>
        </div>
        <IconButton
          icon={<X aria-hidden="true" size={16} />}
          label={t('annotations.closePopover')}
          onClick={() => void handleClose()}
          variant="ghost"
        />
      </div>

      <label
        className="mt-4 block text-sm font-medium"
        htmlFor="annotation-note"
      >
        {t('annotations.noteLabel')}
      </label>
      <textarea
        className="bg-background mt-2 min-h-28 w-full resize-y rounded-md border p-3 text-sm"
        id="annotation-note"
        maxLength={10_000}
        onChange={(event) => {
          updateDraft(event.currentTarget.value);
        }}
        placeholder={t('annotations.notePlaceholder')}
        ref={textareaRef}
        value={draft}
      />

      <div className="mt-3 flex items-center gap-2">
        <Button onClick={() => void save()} size="sm">
          <Save aria-hidden="true" size={14} />
          {t('annotations.save')}
        </Button>
        {onInsertIntoNote ? (
          <Button
            disabled={isInserting}
            onClick={() => void handleInsertIntoNote()}
            size="sm"
            variant="secondary"
          >
            <NotebookPen aria-hidden="true" size={14} />
            {isInserting
              ? t('annotations.creatingNote')
              : t('annotations.insertIntoNote')}
          </Button>
        ) : null}
        <Button
          onClick={() => void handleDelete()}
          size="sm"
          variant="destructive"
        >
          <Trash2 aria-hidden="true" size={14} />
          {confirmDelete
            ? t('annotations.confirmDelete')
            : t('annotations.delete')}
        </Button>
        <span
          aria-live="polite"
          className="text-muted-foreground ml-auto text-xs"
        >
          {saveStatus === 'saving' ? t('common.saving') : null}
          {saveStatus === 'saved' ? t('annotations.saved') : null}
          {saveStatus === 'error' ? t('annotations.saveFailed') : null}
        </span>
      </div>
      {deleteError ? (
        <p className="text-destructive mt-2 text-xs" role="alert">
          {t('annotations.deleteFailed')}
        </p>
      ) : null}
      {insertError ? (
        <p className="text-destructive mt-2 text-xs" role="alert">
          {t('annotations.insertFailed')}
        </p>
      ) : null}
    </section>
  );
}
