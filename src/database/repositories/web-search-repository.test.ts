import {
  createTestAnnotation,
  createTestBook,
  createTestNote,
  createTestWebDatabase,
} from '../../test/fixtures/web-records';
import { WebAnnotationRepository } from './web-annotation-repository';
import { WebBookRepository } from './web-book-repository';
import { WebNoteRepository } from './web-note-repository';
import { WebSearchRepository } from './web-search-repository';

async function setup() {
  const database = createTestWebDatabase();
  const books = new WebBookRepository(database);
  const notes = new WebNoteRepository(database);
  const annotations = new WebAnnotationRepository(database);
  await books.create(createTestBook({ title: '本地搜索测试书' }));
  return {
    database,
    books,
    notes,
    annotations,
    repository: new WebSearchRepository(notes, annotations, books, database),
  };
}

describe('WebSearchRepository', () => {
  it('searches books, notes, and annotations case-insensitively', async () => {
    const { repository, notes, annotations } = await setup();
    await notes.create(createTestNote());
    await annotations.create(
      createTestAnnotation({ text: 'Important LOCAL highlight' }),
    );

    await expect(repository.searchBooks('搜索测试')).resolves.toMatchObject([
      { kind: 'book', id: 'book-1' },
    ]);
    await expect(repository.searchBooks('作者')).resolves.toHaveLength(1);
    await expect(repository.searchNotes('优先')).resolves.toMatchObject([
      { kind: 'note', id: 'note-1', excerpt: '本地优先的笔记正文' },
    ]);
    await expect(
      repository.searchAnnotations('local highlight'),
    ).resolves.toMatchObject([
      { kind: 'annotation', bookTitle: '本地搜索测试书' },
    ]);
    await expect(repository.searchNotes('不存在的内容')).resolves.toEqual([]);
  });

  it('replaces, searches, and clears the derived content index', async () => {
    const { repository } = await setup();
    const longText = `${'前文'.repeat(100)}关键词${'后文'.repeat(200)}`;
    await repository.replaceBookContent('book-1', [
      { chapterHref: 'one.xhtml', chapterTitle: '第一章', text: longText },
      { chapterHref: 'pdf-page:3', chapterTitle: '第 4 页', text: '关键词' },
    ]);
    await repository.replaceBookContent('orphan', [
      { chapterHref: 'x.xhtml', chapterTitle: '孤立', text: '关键词' },
    ]);

    const results = await repository.searchBookContent('关键词');
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      bookTitle: '本地搜索测试书',
      locator: { format: 'epub', chapterHref: 'one.xhtml' },
    });
    expect(results[0]?.excerpt.startsWith('…')).toBe(true);
    expect(results[0]?.excerpt.endsWith('…')).toBe(true);
    expect(results[1]).toMatchObject({
      locator: { format: 'pdf', pageIndex: 3 },
    });
    expect(results[2]).toMatchObject({ bookTitle: '未知书籍' });
    await expect(
      repository.searchBookContent('关键词', 1),
    ).resolves.toHaveLength(1);
    await expect(repository.findIndexedBookIds()).resolves.toEqual([
      'book-1',
      'orphan',
    ]);

    await repository.replaceBookContent('book-1', [
      { chapterHref: 'two.xhtml', chapterTitle: '第二章', text: '新的内容' },
    ]);
    await expect(repository.searchBookContent('关键词')).resolves.toHaveLength(
      1,
    );
    await repository.clearBookContent();
    await expect(repository.findIndexedBookIds()).resolves.toEqual([]);
    await expect(repository.rebuildTextIndexes()).resolves.toBeUndefined();
  });

  it('maps invalid input and corrupt index records to typed errors', async () => {
    const { repository, database } = await setup();

    await expect(
      repository.replaceBookContent('book-1', [
        { chapterHref: '', chapterTitle: '', text: '' },
      ]),
    ).rejects.toMatchObject({ code: 'SEARCH_INDEX_FAILED' });

    await database.write([
      {
        type: 'put',
        store: 'bookContent',
        value: { bookId: 'book-1', ordinal: 0 },
      },
    ]);
    await expect(repository.searchBookContent('任何')).rejects.toMatchObject({
      code: 'SEARCH_FAILED',
    });
  });
});
