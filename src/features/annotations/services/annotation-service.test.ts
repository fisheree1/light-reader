import { describe, expect, it, vi } from 'vitest';

import type { AnnotationRepository } from '../../../database/repositories/annotation-repository';
import type {
  BookLocator,
  EbookReader,
  HighlightRestoreResult,
  ReaderHighlight,
  ReaderTextSelection,
  ReaderTocItem,
} from '../../../reader-engines/types';
import type { Annotation, AnnotationColor } from '../domain/annotation';
import { AnnotationService } from './annotation-service';

const selection: ReaderTextSelection = {
  text: 'selected text',
  textBefore: 'before',
  textAfter: 'after',
  locator: {
    version: 1,
    format: 'epub',
    chapterHref: 'EPUB/one.xhtml',
    cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:4)',
  },
};

function createAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'annotation-1',
    bookId: 'book-1',
    text: selection.text,
    textBefore: selection.textBefore,
    textAfter: selection.textAfter,
    chapterHref: selection.locator.chapterHref ?? null,
    locator: selection.locator,
    color: 'yellow',
    noteText: null,
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  };
}

class MemoryAnnotationRepository implements AnnotationRepository {
  records: Annotation[] = [];
  failColorSave = false;
  failNoteSave = false;

  create(annotation: Annotation): Promise<Annotation> {
    this.records.push(annotation);
    return Promise.resolve(annotation);
  }

  findByBookId(bookId: string): Promise<Annotation[]> {
    return Promise.resolve(
      this.records.filter((annotation) => annotation.bookId === bookId),
    );
  }

  findById(id: string): Promise<Annotation | null> {
    return Promise.resolve(
      this.records.find((annotation) => annotation.id === id) ?? null,
    );
  }

  updateColor(id: string, color: AnnotationColor): Promise<Annotation> {
    if (this.failColorSave)
      return Promise.reject(new Error('database offline'));
    return this.update(id, { color });
  }

  updateNote(id: string, noteText: string | null): Promise<Annotation> {
    if (this.failNoteSave) return Promise.reject(new Error('database offline'));
    return this.update(id, { noteText });
  }

  delete(id: string): Promise<void> {
    this.records = this.records.filter((annotation) => annotation.id !== id);
    return Promise.resolve();
  }

  private update(id: string, value: Partial<Annotation>): Promise<Annotation> {
    const current = this.records.find((annotation) => annotation.id === id);
    if (!current) return Promise.reject(new Error('not found'));
    const updated = { ...current, ...value, updatedAt: current.updatedAt + 1 };
    this.records = this.records.map((annotation) =>
      annotation.id === id ? updated : annotation,
    );
    return Promise.resolve(updated);
  }
}

class FakeAnnotationReader implements EbookReader {
  selection: ReaderTextSelection | null = selection;
  failNavigation = false;
  restoreResults: HighlightRestoreResult[] | null = null;
  readonly createHighlightSpy = vi.fn<(highlight: ReaderHighlight) => void>();
  readonly removeHighlightSpy = vi.fn<(id: string) => void>();
  readonly restoreHighlightsSpy =
    vi.fn<(highlights: ReaderHighlight[]) => void>();

  mount(): void {
    return undefined;
  }
  open(): Promise<void> {
    return Promise.resolve();
  }
  applyDisplaySettings(): void {
    return undefined;
  }
  getTableOfContents(): ReaderTocItem[] {
    return [];
  }
  goTo(): Promise<void> {
    return Promise.resolve();
  }
  previousPage(): Promise<void> {
    return Promise.resolve();
  }
  nextPage(): Promise<void> {
    return Promise.resolve();
  }
  getCurrentLocator(): Promise<BookLocator> {
    return Promise.resolve({ version: 1, format: 'epub' });
  }
  subscribeToRelocation(): () => void {
    return () => undefined;
  }
  getSelection(): ReaderTextSelection | null {
    return this.selection;
  }
  subscribeToSelection(): () => void {
    return () => undefined;
  }
  createHighlight(highlight: ReaderHighlight): Promise<void> {
    this.createHighlightSpy(highlight);
    return Promise.resolve();
  }
  removeHighlight(id: string): Promise<void> {
    this.removeHighlightSpy(id);
    return Promise.resolve();
  }
  restoreHighlights(
    highlights: ReaderHighlight[],
  ): Promise<HighlightRestoreResult[]> {
    this.restoreHighlightsSpy(highlights);
    return Promise.resolve(
      this.restoreResults ??
        highlights.map((highlight) => ({
          id: highlight.id,
          status: 'restored' as const,
        })),
    );
  }
  showHighlight(): Promise<void> {
    return this.failNavigation
      ? Promise.reject(new Error('invalid CFI'))
      : Promise.resolve();
  }
  subscribeToHighlightActivation(): () => void {
    return () => undefined;
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

describe('AnnotationService', () => {
  it('creates a persisted highlight from the engine-neutral selection', async () => {
    const repository = new MemoryAnnotationRepository();
    const reader = new FakeAnnotationReader();
    const service = new AnnotationService(
      repository,
      reader,
      () => 'annotation-1',
      () => 10,
    );

    await expect(
      service.createFromSelection('book-1', 'blue'),
    ).resolves.toMatchObject({
      id: 'annotation-1',
      text: 'selected text',
      color: 'blue',
      locator: selection.locator,
    });
    expect(reader.createHighlightSpy).toHaveBeenCalledWith({
      id: 'annotation-1',
      color: 'blue',
      locator: selection.locator,
    });
    expect(repository.records).toHaveLength(1);
  });

  it('restores highlights without deleting an unresolved locator', async () => {
    const repository = new MemoryAnnotationRepository();
    repository.records = [createAnnotation()];
    const reader = new FakeAnnotationReader();
    reader.restoreResults = [{ id: 'annotation-1', status: 'unresolved' }];
    const service = new AnnotationService(repository, reader);

    await expect(service.restore('book-1')).resolves.toMatchObject({
      annotations: [{ id: 'annotation-1' }],
      restoreResults: [{ id: 'annotation-1', status: 'unresolved' }],
    });
    expect(repository.records).toHaveLength(1);
  });

  it('deletes the database record and rendered highlight', async () => {
    const repository = new MemoryAnnotationRepository();
    const annotation = createAnnotation();
    repository.records = [annotation];
    const reader = new FakeAnnotationReader();
    const service = new AnnotationService(repository, reader);

    await service.delete(annotation);
    expect(reader.removeHighlightSpy).toHaveBeenCalledWith(annotation.id);
    expect(repository.records).toHaveLength(0);
  });

  it('reports a stale locator without deleting its annotation', async () => {
    const repository = new MemoryAnnotationRepository();
    repository.records = [createAnnotation()];
    const reader = new FakeAnnotationReader();
    reader.failNavigation = true;
    const service = new AnnotationService(repository, reader);

    await expect(service.navigateTo('annotation-1')).resolves.toBe(false);
    expect(repository.records).toHaveLength(1);
  });

  it('adds and edits a note, and preserves persisted data on save failure', async () => {
    const repository = new MemoryAnnotationRepository();
    repository.records = [createAnnotation()];
    const service = new AnnotationService(
      repository,
      new FakeAnnotationReader(),
    );

    await expect(
      service.updateNote('annotation-1', ' first note '),
    ).resolves.toMatchObject({ noteText: 'first note' });
    await expect(
      service.updateNote('annotation-1', 'edited note'),
    ).resolves.toMatchObject({ noteText: 'edited note' });

    repository.failNoteSave = true;
    await expect(
      service.updateNote('annotation-1', 'unsaved draft'),
    ).rejects.toThrow('database offline');
    expect(repository.records[0]?.noteText).toBe('edited note');
  });

  it('serializes annotation note saves so older input cannot win a race', async () => {
    const repository = new MemoryAnnotationRepository();
    repository.records = [createAnnotation()];
    const completions: (() => void)[] = [];
    const update = vi.spyOn(repository, 'updateNote').mockImplementation(
      (id, noteText) =>
        new Promise((resolve) => {
          completions.push(() => {
            resolve(createAnnotation({ id, noteText }));
          });
        }),
    );
    const service = new AnnotationService(
      repository,
      new FakeAnnotationReader(),
    );

    const first = service.updateNote('annotation-1', '第一版');
    const second = service.updateNote('annotation-1', '第二版');
    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledTimes(1);
    });
    completions[0]?.();
    await first;
    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledTimes(2);
    });
    completions[1]?.();

    await expect(second).resolves.toMatchObject({ noteText: '第二版' });
  });

  it('restores the rendered color when the database update fails', async () => {
    const repository = new MemoryAnnotationRepository();
    const current = createAnnotation();
    repository.records = [current];
    repository.failColorSave = true;
    const reader = new FakeAnnotationReader();
    const service = new AnnotationService(repository, reader);

    await expect(service.updateColor(current.id, 'red')).rejects.toMatchObject({
      code: 'ANNOTATION_WRITE_FAILED',
    });
    expect(repository.records[0]?.color).toBe('yellow');
    expect(reader.createHighlightSpy).toHaveBeenLastCalledWith({
      id: current.id,
      color: 'yellow',
      locator: current.locator,
    });
  });

  it('restores a large highlight collection within a basic release budget', async () => {
    const repository = new MemoryAnnotationRepository();
    repository.records = Array.from({ length: 2_000 }, (_, index) =>
      createAnnotation({ id: `annotation-${String(index)}` }),
    );
    const reader = new FakeAnnotationReader();
    const service = new AnnotationService(repository, reader);
    const startedAt = performance.now();

    const restored = await service.restore('book-1');

    expect(restored.annotations).toHaveLength(2_000);
    expect(restored.restoreResults).toHaveLength(2_000);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});
