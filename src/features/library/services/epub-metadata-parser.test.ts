import { AppError } from '../../../lib/app-error';
import { createEpubFixture } from '../../../test/fixtures/epub-fixture';
import { FflateEpubMetadataParser } from './epub-metadata-parser';

describe('FflateEpubMetadataParser', () => {
  const parser = new FflateEpubMetadataParser();

  it('reads EPUB metadata and cover', async () => {
    const result = await parser.parse(createEpubFixture(), 'fallback.epub');

    expect(result.metadata).toEqual({
      title: '测试图书',
      creators: ['测试作者'],
      language: 'zh-CN',
      publisher: 'LightReader 测试出版社',
      description: '自制的无版权测试 EPUB。',
      identifier: 'urn:lightreader:test',
    });
    expect(result.cover).toMatchObject({
      extension: 'png',
      mediaType: 'image/png',
    });
  });

  it('falls back to the source filename when title and author are missing', async () => {
    const result = await parser.parse(
      createEpubFixture({ title: null, author: null, includeCover: false }),
      '没有元数据.epub',
    );

    expect(result.metadata.title).toBe('没有元数据');
    expect(result.metadata.creators).toEqual([]);
    expect(result.cover).toBeNull();
  });

  it('maps a corrupt archive to INVALID_EPUB', async () => {
    await expect(
      parser.parse(new Uint8Array([1, 2, 3]), 'broken.epub'),
    ).rejects.toMatchObject({
      code: 'INVALID_EPUB',
    } satisfies Partial<AppError>);
  });
});
