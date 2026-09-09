import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { asAppError } from '../../../lib/app-error';
import type { Note, NoteDocument } from '../domain/note';
import { NoteService } from '../services/note-service';
import { LocalNoteDraftStorage } from '../services/note-draft-storage';
import type { NotesServices } from '../services/notes-services';

export type NoteSaveStatus = 'error' | 'idle' | 'saved' | 'saving';

const autoSaveDelay = 700;

function fingerprint(note: Note): string {
  return JSON.stringify({ title: note.title, document: note.document });
}

export function useNotes(
  services: NotesServices,
  requestedNoteId: string | null,
) {
  const service = useMemo(
    () => new NoteService(services.noteRepository),
    [services.noteRepository],
  );
  const draftStorage = useMemo(
    () => services.draftStorage ?? new LocalNoteDraftStorage(),
    [services.draftStorage],
  );
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<NoteSaveStatus>('idle');
  const [mutationError, setMutationError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const draftRef = useRef<Note | null>(null);
  const savedFingerprintRef = useRef('');
  const draftBaseUpdatedAtRef = useRef(0);

  const activate = useCallback(
    (note: Note | null) => {
      clearTimeout(timerRef.current);
      const recovered = note ? draftStorage.recover(note) : null;
      draftRef.current = recovered ?? note;
      draftBaseUpdatedAtRef.current = note?.updatedAt ?? 0;
      savedFingerprintRef.current = note ? fingerprint(note) : '';
      setActiveNote(recovered ?? note);
      setSaveStatus(recovered ? 'error' : 'idle');
      setMutationError(recovered ? '已恢复上次异常退出前的未保存内容。' : null);
    },
    [draftStorage],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = await service.list();
      setNotes(loaded);
      const requested = requestedNoteId
        ? loaded.find((note) => note.id === requestedNoteId)
        : undefined;
      activate(requested ?? loaded.at(0) ?? null);
    } catch (error) {
      setLoadError(asAppError(error, 'NOTE_READ_FAILED').userMessage);
    } finally {
      setLoading(false);
    }
  }, [activate, requestedNoteId, service]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const saveDraft = useCallback(
    async (candidate = draftRef.current): Promise<boolean> => {
      clearTimeout(timerRef.current);
      if (
        !candidate ||
        fingerprint(candidate) === savedFingerprintRef.current
      ) {
        return true;
      }
      const candidateFingerprint = fingerprint(candidate);
      if (candidate.documentRecovered) {
        setSaveStatus('error');
        setMutationError('原笔记内容损坏；请先编辑正文，再保存恢复后的内容。');
        return false;
      }
      setSaveStatus('saving');
      setMutationError(null);
      try {
        const saved = await service.save(candidate.id, {
          title: candidate.title.trim() || '未命名笔记',
          document: candidate.document,
        });
        setNotes((current) =>
          current
            .map((note) => (note.id === saved.id ? saved : note))
            .sort(
              (left, right) =>
                right.updatedAt - left.updatedAt ||
                left.id.localeCompare(right.id),
            ),
        );
        if (
          draftRef.current?.id === candidate.id &&
          fingerprint(draftRef.current) === candidateFingerprint
        ) {
          draftStorage.clear(candidate.id);
          draftBaseUpdatedAtRef.current = saved.updatedAt;
          savedFingerprintRef.current = candidateFingerprint;
          const currentDraft = { ...saved, title: draftRef.current.title };
          draftRef.current = currentDraft;
          setActiveNote(currentDraft);
          setSaveStatus('saved');
        }
        return true;
      } catch (error) {
        if (draftRef.current?.id === candidate.id) {
          setSaveStatus('error');
          setMutationError(asAppError(error, 'NOTE_WRITE_FAILED').userMessage);
        }
        return false;
      }
    },
    [draftStorage, service],
  );

  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      const draft = draftRef.current;
      if (draft && fingerprint(draft) !== savedFingerprintRef.current) {
        void service
          .save(draft.id, {
            title: draft.title.trim() || '未命名笔记',
            document: draft.document,
          })
          .catch(() => undefined);
      }
    },
    [service],
  );

  const scheduleSave = useCallback(
    (next: Note) => {
      setSaveStatus('saving');
      setMutationError(null);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void saveDraft(next);
      }, autoSaveDelay);
    },
    [saveDraft],
  );

  const updateDraft = useCallback(
    (change: { document?: NoteDocument; title?: string }) => {
      const current = draftRef.current;
      if (!current) return;
      const next = { ...current, ...change, documentRecovered: false };
      if (!change.document && current.documentRecovered) {
        next.documentRecovered = true;
      }
      draftRef.current = next;
      setActiveNote(next);
      try {
        draftStorage.write(next, draftBaseUpdatedAtRef.current);
      } catch (error) {
        setMutationError(asAppError(error, 'NOTE_WRITE_FAILED').userMessage);
      }
      scheduleSave(next);
    },
    [draftStorage, scheduleSave],
  );

  const selectNote = useCallback(
    async (id: string) => {
      if (draftRef.current?.id === id) return;
      if (!(await saveDraft())) return;
      const note = notes.find((item) => item.id === id) ?? null;
      activate(note);
    },
    [activate, notes, saveDraft],
  );

  const createNote = useCallback(async () => {
    if (!(await saveDraft())) return null;
    setMutationError(null);
    try {
      const note = await service.createEmpty();
      setNotes((current) => [note, ...current]);
      activate(note);
      return note;
    } catch (error) {
      setMutationError(asAppError(error, 'NOTE_WRITE_FAILED').userMessage);
      return null;
    }
  }, [activate, saveDraft, service]);

  const deleteActiveNote = useCallback(async () => {
    const note = draftRef.current;
    if (!note) return false;
    clearTimeout(timerRef.current);
    setMutationError(null);
    try {
      await service.delete(note.id);
      draftStorage.clear(note.id);
      const remaining = notes.filter((item) => item.id !== note.id);
      setNotes(remaining);
      activate(remaining[0] ?? null);
      return true;
    } catch (error) {
      setMutationError(asAppError(error, 'NOTE_WRITE_FAILED').userMessage);
      return false;
    }
  }, [activate, draftStorage, notes, service]);

  const visibleNotes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? notes.filter((note) =>
          note.title.toLocaleLowerCase().includes(normalized),
        )
      : notes;
  }, [notes, query]);

  return {
    activeNote,
    createNote,
    deleteActiveNote,
    hasNotes: notes.length > 0,
    load,
    loading,
    loadError,
    mutationError,
    query,
    retrySave: saveDraft,
    saveStatus,
    selectNote,
    setQuery,
    updateDraft,
    visibleNotes,
  };
}
