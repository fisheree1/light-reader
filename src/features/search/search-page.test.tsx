import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import type { BookRepository } from '../../database/repositories/book-repository';
import type { SearchRepository } from '../../database/repositories/search-repository';
import type { ReaderBookSource } from '../reader/services/reader-book-source';
import type { EpubContentParser } from './services/epub-content-parser';
import { LocalSearchService } from './services/local-search-service';
import { SearchPage } from './search-page';

function createServices() {
  const repository: SearchRepository = {
    searchNotes: (query) =>
      Promise.resolve(
        query === '中文搜索'
          ? [
              {
                kind: 'note',
                id: 'note-1',
                title: '本地笔记',
                excerpt: '中文搜索正文',
                updatedAt: 1,
              },
            ]
          : [],
      ),
    searchAnnotations: () => Promise.resolve([]),
    searchBookContent: () => Promise.resolve([]),
    findIndexedBookIds: () => Promise.resolve([]),
    replaceBookContent: () => Promise.resolve(),
    clearBookContent: () => Promise.resolve(),
    rebuildTextIndexes: () => Promise.resolve(),
  };
  const books: BookRepository = {
    create: (book) => Promise.resolve(book),
    findById: () => Promise.resolve(null),
    findByHash: () => Promise.resolve(null),
    list: () => Promise.resolve([]),
    delete: () => Promise.resolve(),
  };
  const source: ReaderBookSource = {
    read: () => Promise.resolve(new ArrayBuffer(0)),
  };
  const parser: EpubContentParser = { parse: () => Promise.resolve([]) };
  return {
    repository,
    localSearch: new LocalSearchService(repository, books, source, parser),
  };
}

describe('SearchPage', () => {
  it('shows local results, empty results, and rebuild confirmation', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SearchPage services={createServices()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '搜索本地内容' })).toBeVisible();
    const input = screen.getByRole('searchbox', { name: '搜索本地内容' });
    await user.type(input, '中文搜索');
    await user.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByText('本地笔记')).toBeVisible();
    expect(screen.getByText('找到 1 条结果')).toBeVisible();

    await user.clear(input);
    await user.type(input, '没有结果');
    await user.click(screen.getByRole('button', { name: '搜索' }));
    expect(
      await screen.findByRole('heading', { name: '没有搜索结果' }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: '索引维护' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      '已重建索引：0 本 EPUB，全部成功',
    );
  });
});
