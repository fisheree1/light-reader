import type { AnnotationRepository } from '../../../database/repositories/annotation-repository';
import type {
  EbookReader,
  HighlightRestoreResult,
  ReaderHighlight,
} from '../../../reader-engines/types';
import {
  annotationColorSchema,
  annotationSchema,
  normalizeNoteText,
  type Annotation,
  type AnnotationColor,
} from '../domain/annotation';
import { AppError, asAppError } from '../../../lib/app-error';

export interface AnnotationRestoreResult {
  annotations: Annotation[];
  restoreResults: HighlightRestoreResult[];
}

type IdFactory = () => string;
type Now = () => number;

function toReaderHighlight(annotation: Annotation): ReaderHighlight {
  return {
    id: annotation.id,
    locator: annotation.locator,
    color: annotation.color,
  };
}

export class AnnotationService {
  private readonly noteSaveQueues = new Map<string, Promise<void>>();
  private readonly repository: AnnotationRepository;
  private readonly reader: EbookReader;
  private readonly idFactory: IdFactory;
  private readonly now: Now;

  constructor(
    repository: AnnotationRepository,
    reader: EbookReader,
    idFactory: IdFactory = () => crypto.randomUUID(),
    now: Now = Date.now,
  ) {
    this.repository = repository;
    this.reader = reader;
    this.idFactory = idFactory;
    this.now = now;
  }

  async restore(bookId: string): Promise<AnnotationRestoreResult> {
    const annotations = await this.repository.findByBookId(bookId);
    const restoreResults = await this.reader.restoreHighlights(
      annotations.map(toReaderHighlight),
    );
    return { annotations, restoreResults };
  }

  async createFromSelection(
    bookId: string,
    value: AnnotationColor,
  ): Promise<Annotation> {
    const color = annotationColorSchema.parse(value);
    const selection = this.reader.getSelection();
    if (!selection) throw new AppError('ANNOTATION_SELECTION_EMPTY');
    const timestamp = this.now();
    const annotation = annotationSchema.parse({
      id: this.idFactory(),
      bookId,
      text: selection.text,
      textBefore: selection.textBefore,
      textAfter: selection.textAfter,
      chapterHref:
        selection.locator.format === 'epub'
          ? (selection.locator.chapterHref ?? null)
          : null,
      locator: selection.locator,
      color,
      noteText: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await this.reader.createHighlight(toReaderHighlight(annotation));
    try {
      return await this.repository.create(annotation);
    } catch (error) {
      await this.reader.removeHighlight(annotation.id).catch(() => undefined);
      throw asAppError(error, 'ANNOTATION_WRITE_FAILED');
    }
  }

  async updateNote(annotationId: string, value: string): Promise<Annotation> {
    const noteText = normalizeNoteText(value);
    const previous = this.noteSaveQueues.get(annotationId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(() => this.repository.updateNote(annotationId, noteText));
    const settled = operation.then(
      () => undefined,
      () => undefined,
    );
    this.noteSaveQueues.set(annotationId, settled);
    void settled.then(() => {
      if (this.noteSaveQueues.get(annotationId) === settled) {
        this.noteSaveQueues.delete(annotationId);
      }
    });
    return operation;
  }

  async updateColor(
    annotationId: string,
    value: AnnotationColor,
  ): Promise<Annotation> {
    const color = annotationColorSchema.parse(value);
    const current = await this.repository.findById(annotationId);
    if (!current) throw new AppError('ANNOTATION_NOT_FOUND');
    const rendered = { ...current, color };
    await this.reader.removeHighlight(annotationId);
    try {
      await this.reader.createHighlight(toReaderHighlight(rendered));
    } catch (error) {
      await this.reader
        .createHighlight(toReaderHighlight(current))
        .catch(() => undefined);
      throw asAppError(error, 'ANNOTATION_RENDER_FAILED');
    }
    try {
      return await this.repository.updateColor(annotationId, color);
    } catch (error) {
      await this.reader.removeHighlight(annotationId).catch(() => undefined);
      await this.reader
        .createHighlight(toReaderHighlight(current))
        .catch(() => undefined);
      throw asAppError(error, 'ANNOTATION_WRITE_FAILED');
    }
  }

  async delete(annotation: Annotation): Promise<void> {
    await this.reader.removeHighlight(annotation.id).catch(() => undefined);
    try {
      await this.repository.delete(annotation.id);
    } catch (error) {
      await this.reader
        .createHighlight(toReaderHighlight(annotation))
        .catch(() => undefined);
      throw asAppError(error, 'ANNOTATION_WRITE_FAILED');
    }
  }

  async navigateTo(annotationId: string): Promise<boolean> {
    try {
      await this.reader.showHighlight(annotationId);
      return true;
    } catch {
      return false;
    }
  }
}

export { toReaderHighlight };
