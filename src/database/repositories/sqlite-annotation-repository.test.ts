import { describe, expect, it } from 'vitest';

import type { Annotation } from '../../features/annotations/domain/annotation';
import type { SqlDatabase } from '../client';
import type { AnnotationRecord } from '../schema/annotation-record';
import { SqliteAnnotationRepository } from './sqlite-annotation-repository';

function createAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'annotation-1',
    bookId: 'book-1',
    text: 'selected text',
    textBefore: 'before',
    textAfter: 'after',
    chapterHref: 'EPUB/one.xhtml',
    locator: {
      version: 1,
      format: 'epub',
      chapterHref: 'EPUB/one.xhtml',
      cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:4)',
    },
    color: 'yellow',
    noteText: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

class FakeAnnotationDatabase implements SqlDatabase {
  records: AnnotationRecord[] = [];

  execute(query: string, values: unknown[] = []): Promise<unknown> {
    if (query.includes('INSERT INTO annotations')) {
      this.records.push({
        id: String(values[0]),
        book_id: String(values[1]),
        text: String(values[2]),
        text_before: typeof values[3] === 'string' ? values[3] : null,
        text_after: typeof values[4] === 'string' ? values[4] : null,
        chapter_href: typeof values[5] === 'string' ? values[5] : null,
        locator_json: String(values[6]),
        color: String(values[7]),
        note_text: typeof values[8] === 'string' ? values[8] : null,
        created_at: Number(values[9]),
        updated_at: Number(values[10]),
      });
    } else if (query.startsWith('UPDATE annotations SET color')) {
      this.records = this.records.map((record) =>
        record.id === values[2]
          ? {
              ...record,
              color: String(values[0]),
              updated_at: Number(values[1]),
            }
          : record,
      );
    } else if (query.startsWith('UPDATE annotations SET note_text')) {
      this.records = this.records.map((record) =>
        record.id === values[2]
          ? {
              ...record,
              note_text: typeof values[0] === 'string' ? values[0] : null,
              updated_at: Number(values[1]),
            }
          : record,
      );
    } else if (query.startsWith('DELETE FROM annotations')) {
      this.records = this.records.filter((record) => record.id !== values[0]);
    }
    return Promise.resolve({});
  }

  select<T>(query: string, values: unknown[] = []): Promise<T> {
    let records = [...this.records];
    if (query.includes('WHERE book_id')) {
      records = records.filter((record) => record.book_id === values[0]);
      records.sort((left, right) => right.created_at - left.created_at);
    } else if (query.includes('WHERE id')) {
      records = records.filter((record) => record.id === values[0]);
    }
    return Promise.resolve(records as T);
  }
}

describe('SqliteAnnotationRepository', () => {
  it('creates, reads, updates, lists, and deletes annotations', async () => {
    const database = new FakeAnnotationDatabase();
    const repository = new SqliteAnnotationRepository(() =>
      Promise.resolve(database),
    );
    const older = createAnnotation();
    const newer = createAnnotation({
      id: 'annotation-2',
      text: 'newer selection',
      createdAt: 2,
      updatedAt: 2,
    });

    await repository.create(older);
    await repository.create(newer);
    await expect(repository.findById(older.id)).resolves.toMatchObject(older);
    await expect(repository.findByBookId('book-1')).resolves.toEqual([
      newer,
      older,
    ]);

    await expect(
      repository.updateColor(older.id, 'blue'),
    ).resolves.toMatchObject({ id: older.id, color: 'blue' });
    await expect(
      repository.updateNote(older.id, 'my annotation'),
    ).resolves.toMatchObject({ id: older.id, noteText: 'my annotation' });

    await repository.delete(older.id);
    await expect(repository.findById(older.id)).resolves.toBeNull();
  });

  it('reads persisted records after repository reinitialization', async () => {
    const database = new FakeAnnotationDatabase();
    await new SqliteAnnotationRepository(() =>
      Promise.resolve(database),
    ).create(createAnnotation({ noteText: 'persistent note' }));

    const reopened = new SqliteAnnotationRepository(() =>
      Promise.resolve(database),
    );
    await expect(reopened.findByBookId('book-1')).resolves.toMatchObject([
      { id: 'annotation-1', noteText: 'persistent note' },
    ]);
  });
});
