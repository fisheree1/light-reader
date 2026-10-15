import {
  annotationColorSchema,
  annotationSchema,
  type Annotation,
  type AnnotationColor,
} from '../../features/annotations/domain/annotation';
import { AppError } from '../../lib/app-error';
import { getWebDatabase, type WebDatabase } from '../web/web-database';
import { parseRecords, withAppError } from '../web/web-repository-support';
import type { AnnotationRepository } from './annotation-repository';

export class WebAnnotationRepository implements AnnotationRepository {
  private readonly database: WebDatabase;

  constructor(database: WebDatabase = getWebDatabase()) {
    this.database = database;
  }

  create(value: Annotation): Promise<Annotation> {
    return withAppError('ANNOTATION_WRITE_FAILED', async () => {
      const annotation = annotationSchema.parse(value);
      await this.database.write([
        { type: 'add', store: 'annotations', value: annotation },
      ]);
      return annotation;
    });
  }

  findByBookId(bookId: string): Promise<Annotation[]> {
    return withAppError('ANNOTATION_READ_FAILED', async () =>
      parseRecords(
        annotationSchema,
        await this.database.getAllByBook('annotations', bookId),
      ).sort((left, right) => right.createdAt - left.createdAt),
    );
  }

  findById(id: string): Promise<Annotation | null> {
    return withAppError('ANNOTATION_READ_FAILED', async () => {
      const value = await this.database.get('annotations', id);
      return value === undefined ? null : annotationSchema.parse(value);
    });
  }

  updateColor(id: string, value: AnnotationColor): Promise<Annotation> {
    const color = annotationColorSchema.parse(value);
    return this.update(id, (annotation) => ({ ...annotation, color }));
  }

  updateNote(id: string, noteText: string | null): Promise<Annotation> {
    const note = annotationSchema.shape.noteText.parse(noteText);
    return this.update(id, (annotation) => ({ ...annotation, noteText: note }));
  }

  delete(id: string): Promise<void> {
    return withAppError('ANNOTATION_WRITE_FAILED', () =>
      this.database.write([{ type: 'delete', store: 'annotations', key: id }]),
    );
  }

  private update(
    id: string,
    transform: (annotation: Annotation) => Annotation,
  ): Promise<Annotation> {
    return withAppError('ANNOTATION_WRITE_FAILED', async () => {
      const current = await this.findById(id);
      if (!current) throw new AppError('ANNOTATION_NOT_FOUND');
      const updated = annotationSchema.parse({
        ...transform(current),
        updatedAt: Date.now(),
      });
      await this.database.write([
        { type: 'put', store: 'annotations', value: updated },
      ]);
      return updated;
    });
  }
}
