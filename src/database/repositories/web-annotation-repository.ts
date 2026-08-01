import {
  annotationColorSchema,
  annotationSchema,
  type Annotation,
  type AnnotationColor,
} from '../../features/annotations/domain/annotation';
import { AppError } from '../../lib/app-error';
import type { AnnotationRepository } from './annotation-repository';

const storageKey = 'light-reader-web-annotations';

export class WebAnnotationRepository implements AnnotationRepository {
  create(value: Annotation): Promise<Annotation> {
    return this.run(() => {
      const annotation = annotationSchema.parse(value);
      const annotations = this.read();
      if (annotations.some((item) => item.id === annotation.id)) {
        throw new Error('Duplicate annotation id');
      }
      this.write([annotation, ...annotations]);
      return annotation;
    });
  }

  findByBookId(bookId: string): Promise<Annotation[]> {
    return this.readResult(() =>
      this.read()
        .filter((annotation) => annotation.bookId === bookId)
        .sort((left, right) => right.createdAt - left.createdAt),
    );
  }

  findById(id: string): Promise<Annotation | null> {
    return this.readResult(
      () => this.read().find((annotation) => annotation.id === id) ?? null,
    );
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
    return this.run(() => {
      this.write(this.read().filter((annotation) => annotation.id !== id));
    });
  }

  private update(
    id: string,
    transform: (annotation: Annotation) => Annotation,
  ): Promise<Annotation> {
    return this.run(() => {
      const annotations = this.read();
      const current = annotations.find((annotation) => annotation.id === id);
      if (!current) throw new AppError('ANNOTATION_NOT_FOUND');
      const updated = annotationSchema.parse({
        ...transform(current),
        updatedAt: Date.now(),
      });
      this.write(
        annotations.map((annotation) =>
          annotation.id === id ? updated : annotation,
        ),
      );
      return updated;
    });
  }

  private read(): Annotation[] {
    const value = localStorage.getItem(storageKey);
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    return annotationSchema.array().parse(parsed);
  }

  private write(annotations: Annotation[]): void {
    localStorage.setItem(storageKey, JSON.stringify(annotations));
  }

  private readResult<T>(action: () => T): Promise<T> {
    return Promise.resolve()
      .then(action)
      .catch((error: unknown) => {
        throw error instanceof AppError
          ? error
          : new AppError('ANNOTATION_READ_FAILED', { cause: error });
      });
  }

  private run<T>(action: () => T): Promise<T> {
    return Promise.resolve()
      .then(action)
      .catch((error: unknown) => {
        throw error instanceof AppError
          ? error
          : new AppError('ANNOTATION_WRITE_FAILED', { cause: error });
      });
  }
}
