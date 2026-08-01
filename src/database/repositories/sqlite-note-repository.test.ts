import type { SqlDatabase } from '../client';
import type { NoteRecord } from '../schema/note-record';
import {
  createEmptyNoteDocument,
  type Note,
} from '../../features/notes/domain/note';
import { SqliteNoteRepository } from './sqlite-note-repository';

class MemoryNoteDatabase implements SqlDatabase {
  readonly rows = new Map<string, NoteRecord>();

  execute(query: string, values: unknown[] = []): Promise<unknown> {
    if (query.includes('INSERT INTO notes')) {
      const [id, title, contentJson, plainText, createdAt, updatedAt] = values;
      if (this.rows.has(String(id))) return Promise.reject(new Error('UNIQUE'));
      this.rows.set(String(id), {
        id: String(id),
        title: String(title),
        content_json: String(contentJson),
        plain_text: String(plainText),
        created_at: Number(createdAt),
        updated_at: Number(updatedAt),
      });
    } else if (query.includes('UPDATE notes')) {
      const [title, contentJson, plainText, updatedAt, id] = values;
      const current = this.rows.get(String(id));
      if (current) {
        this.rows.set(String(id), {
          ...current,
          title: String(title),
          content_json: String(contentJson),
          plain_text: String(plainText),
          updated_at: Number(updatedAt),
        });
      }
    } else if (query.includes('DELETE FROM notes')) {
      this.rows.delete(String(values[0]));
    }
    return Promise.resolve({ rowsAffected: 1 });
  }

  select<T>(query: string, values: unknown[] = []): Promise<T> {
    let rows = [...this.rows.values()];
    if (query.includes('WHERE id =')) {
      rows = rows.filter((row) => row.id === String(values[0]));
    } else if (query.includes('WHERE title LIKE')) {
      const needle = String(values[0]).replaceAll('%', '').toLowerCase();
      rows = rows.filter((row) => row.title.toLowerCase().includes(needle));
    }
    rows.sort(
      (left, right) =>
        right.updated_at - left.updated_at || left.id.localeCompare(right.id),
    );
    return Promise.resolve(rows as T);
  }
}

const document = createEmptyNoteDocument();

function note(id: string, title: string, createdAt: number): Note {
  return {
    id,
    title,
    document,
    plainText: '',
    documentRecovered: false,
    createdAt,
    updatedAt: createdAt,
  };
}

describe('SqliteNoteRepository', () => {
  it('creates, restores JSON, searches, updates, deletes, and survives reinitialization', async () => {
    const database = new MemoryNoteDatabase();
    const repository = new SqliteNoteRepository(() =>
      Promise.resolve(database),
    );
    await repository.create(note('note-1', '阅读想法', 1));
    await repository.create(note('note-2', '其他记录', 2));

    expect((await repository.list()).map((item) => item.id)).toEqual([
      'note-2',
      'note-1',
    ]);
    expect((await repository.list('阅读')).map((item) => item.id)).toEqual([
      'note-1',
    ]);

    const changedDocument = {
      schemaVersion: 1 as const,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '持久化正文' }],
          },
        ],
      },
    };
    await repository.update('note-1', {
      title: '更新标题',
      document: changedDocument,
    });

    const reopened = new SqliteNoteRepository(() => Promise.resolve(database));
    expect(await reopened.findById('note-1')).toEqual(
      expect.objectContaining({
        title: '更新标题',
        document: changedDocument,
        plainText: '持久化正文',
      }),
    );

    await reopened.delete('note-1');
    expect(await reopened.findById('note-1')).toBeNull();
  });

  it('maps duplicate ids to a note write error', async () => {
    const database = new MemoryNoteDatabase();
    const repository = new SqliteNoteRepository(() =>
      Promise.resolve(database),
    );
    await repository.create(note('note-1', '第一条', 1));

    await expect(
      repository.create(note('note-1', '重复', 2)),
    ).rejects.toMatchObject({
      code: 'NOTE_WRITE_FAILED',
    });
  });
});
