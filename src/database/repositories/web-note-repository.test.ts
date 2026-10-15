import {
  createTestNote,
  createTestWebDatabase,
} from '../../test/fixtures/web-records';
import { WebNoteRepository } from './web-note-repository';

describe('WebNoteRepository', () => {
  it('creates, searches, updates, deletes, and survives reinitialization', async () => {
    const database = createTestWebDatabase();
    const repository = new WebNoteRepository(database);
    const created = await repository.create(
      createTestNote({ documentRecovered: true }),
    );
    expect(created).toMatchObject({
      plainText: '本地优先的笔记正文',
      documentRecovered: false,
    });
    await repository.create(
      createTestNote({ id: 'note-2', title: '另一条', updatedAt: 5 }),
    );

    await expect(repository.list()).resolves.toMatchObject([
      { id: 'note-2' },
      { id: 'note-1' },
    ]);
    await expect(repository.list(' 读书 ')).resolves.toMatchObject([
      { id: 'note-1' },
    ]);

    const updated = await repository.update('note-1', {
      title: '新标题',
      document: created.document,
    });
    expect(updated.title).toBe('新标题');
    await expect(
      new WebNoteRepository(database).findById('note-1'),
    ).resolves.toMatchObject({ title: '新标题' });

    await repository.delete('note-1');
    await expect(repository.findById('note-1')).resolves.toBeNull();
  });

  it('maps duplicate ids and missing notes to typed errors', async () => {
    const repository = new WebNoteRepository(createTestWebDatabase());
    await repository.create(createTestNote());

    await expect(repository.create(createTestNote())).rejects.toMatchObject({
      code: 'NOTE_WRITE_FAILED',
    });
    await expect(
      repository.update('missing', {
        title: '标题',
        document: createTestNote().document,
      }),
    ).rejects.toMatchObject({ code: 'NOTE_NOT_FOUND' });
  });

  it('maps corrupt stored notes to a read error', async () => {
    const database = createTestWebDatabase();
    await database.write([
      { type: 'put', store: 'notes', value: { id: 'broken' } },
    ]);

    await expect(new WebNoteRepository(database).list()).rejects.toMatchObject({
      code: 'NOTE_READ_FAILED',
    });
  });
});
