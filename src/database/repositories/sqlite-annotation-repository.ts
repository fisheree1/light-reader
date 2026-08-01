import {
  annotationColorSchema,
  annotationSchema,
  type Annotation,
  type AnnotationColor,
} from '../../features/annotations/domain/annotation';
import { AppError, isAppError } from '../../lib/app-error';
import { getDatabase, type SqlDatabase } from '../client';
import {
  mapAnnotationRecord,
  type AnnotationRecord,
} from '../schema/annotation-record';
import type { AnnotationRepository } from './annotation-repository';

type DatabaseProvider = () => Promise<SqlDatabase>;

const annotationColumns = `id, book_id, text, text_before, text_after,
  chapter_href, locator_json, color, note_text, created_at, updated_at`;

function validId(value: string): string {
  const id = value.trim();
  if (!id || id.length > 128) throw new AppError('ANNOTATION_NOT_FOUND');
  return id;
}

export class SqliteAnnotationRepository implements AnnotationRepository {
  private readonly databaseProvider: DatabaseProvider;

  constructor(databaseProvider: DatabaseProvider = getDatabase) {
    this.databaseProvider = databaseProvider;
  }

  async create(value: Annotation): Promise<Annotation> {
    const annotation = annotationSchema.parse(value);
    try {
      const database = await this.databaseProvider();
      await database.execute(
        `INSERT INTO annotations (
          id, book_id, text, text_before, text_after, chapter_href,
          locator_json, color, note_text, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          annotation.id,
          annotation.bookId,
          annotation.text,
          annotation.textBefore,
          annotation.textAfter,
          annotation.chapterHref,
          JSON.stringify(annotation.locator),
          annotation.color,
          annotation.noteText,
          annotation.createdAt,
          annotation.updatedAt,
        ],
      );
      return annotation;
    } catch (error) {
      throw new AppError('ANNOTATION_WRITE_FAILED', { cause: error });
    }
  }

  async findByBookId(bookId: string): Promise<Annotation[]> {
    const id = validId(bookId);
    try {
      const database = await this.databaseProvider();
      const rows = await database.select<AnnotationRecord[]>(
        `SELECT ${annotationColumns} FROM annotations
         WHERE book_id = $1 ORDER BY created_at DESC, id ASC`,
        [id],
      );
      return rows.map(mapAnnotationRecord);
    } catch (error) {
      throw new AppError('ANNOTATION_READ_FAILED', { cause: error });
    }
  }

  async findById(id: string): Promise<Annotation | null> {
    try {
      const database = await this.databaseProvider();
      const rows = await database.select<AnnotationRecord[]>(
        `SELECT ${annotationColumns} FROM annotations
         WHERE id = $1 LIMIT 1`,
        [validId(id)],
      );
      return rows[0] ? mapAnnotationRecord(rows[0]) : null;
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('ANNOTATION_READ_FAILED', { cause: error });
    }
  }

  async updateColor(id: string, value: AnnotationColor): Promise<Annotation> {
    const color = annotationColorSchema.parse(value);
    return this.update(
      id,
      'UPDATE annotations SET color = $1, updated_at = $2 WHERE id = $3',
      [color, Date.now(), validId(id)],
    );
  }

  async updateNote(id: string, noteText: string | null): Promise<Annotation> {
    const note = annotationSchema.shape.noteText.parse(noteText);
    return this.update(
      id,
      'UPDATE annotations SET note_text = $1, updated_at = $2 WHERE id = $3',
      [note, Date.now(), validId(id)],
    );
  }

  async delete(id: string): Promise<void> {
    try {
      const database = await this.databaseProvider();
      await database.execute('DELETE FROM annotations WHERE id = $1', [
        validId(id),
      ]);
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('ANNOTATION_WRITE_FAILED', { cause: error });
    }
  }

  private async update(
    id: string,
    query: string,
    values: unknown[],
  ): Promise<Annotation> {
    try {
      const database = await this.databaseProvider();
      await database.execute(query, values);
      const annotation = await this.findById(id);
      if (!annotation) throw new AppError('ANNOTATION_NOT_FOUND');
      return annotation;
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('ANNOTATION_WRITE_FAILED', { cause: error });
    }
  }
}
