import { createTestBook } from '../../../test/fixtures/web-records';
import {
  FixtureOpdsGateway,
  OPDS_FIXTURE_ROOT,
} from '../../../test/fixtures/opds-gateway';
import type { BookImporter } from '../../library/services/book-import-service';
import { bookFileName, OpdsService } from './opds-service';

const catalog = { id: 'c', title: '测试书库', url: OPDS_FIXTURE_ROOT };

function setup() {
  const gateway = new FixtureOpdsGateway();
  const importBytes = vi
    .fn<NonNullable<BookImporter['importBytes']>>()
    .mockResolvedValue({ status: 'created', book: createTestBook() });
  return {
    gateway,
    importBytes,
    service: new OpdsService(gateway, { importEpub: vi.fn(), importBytes }),
  };
}

describe('OpdsService', () => {
  const signal = new AbortController().signal;

  it('searches through the OpenSearch description, fetched once', async () => {
    const { gateway, service } = setup();
    const read = vi.spyOn(gateway, 'readFeed');
    const root = await service.open(catalog, catalog.url, signal);
    const found = await service.search(catalog, root, '测试', signal);
    expect(found.title).toBe('搜索：测试');
    await service.search(catalog, root, '再次', signal);
    expect(read.mock.calls.map(([, url]) => url)).toEqual([
      'https://opds.test/catalog',
      'https://opds.test/opensearch.xml',
      'https://opds.test/search?q=%E6%B5%8B%E8%AF%95&page=',
      'https://opds.test/search?q=%E5%86%8D%E6%AC%A1&page=',
    ]);
    await expect(
      service.search(catalog, { ...root, search: null }, '测试', signal),
    ).rejects.toMatchObject({ code: 'OPDS_NO_SEARCH' });
  });

  it('downloads the preferred format and imports it with a safe file name', async () => {
    const { gateway, importBytes, service } = setup();
    const download = vi.spyOn(gateway, 'download');
    const feed = await service.open(
      catalog,
      'https://opds.test/catalog/new',
      signal,
    );
    const result = await service.acquire(catalog, feed.entries[0], signal);
    expect(result).toMatchObject({ status: 'created', format: 'epub' });
    expect(download).toHaveBeenCalledWith(
      catalog.url,
      'https://opds.test/books/1.epub',
      'book',
      signal,
    );
    expect(importBytes.mock.calls[0]?.[0]).toBe('原创测试长篇.epub');
    await expect(
      service.acquire(catalog, feed.entries[1], signal),
    ).rejects.toMatchObject({ code: 'OPDS_NO_FORMAT' });
    expect(bookFileName('a/b:c*?\u0000 "d"', 'pdf')).toBe('a b c d.pdf');
    expect(bookFileName('   ', 'epub')).toBe('book.epub');
  });
});
