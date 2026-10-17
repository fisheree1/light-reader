import { AppError } from '../../../lib/app-error';
import { createEpubFixture } from '../../../test/fixtures/epub-fixture';
import { FflateEpubMetadataParser, readSeries } from './epub-metadata-parser';

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
      series: null,
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

  it('reads a series from EPUB 3 collections, then Calibre metadata', () => {
    const opf = (metadata: string) =>
      new DOMParser().parseFromString(
        `<package xmlns="http://www.idpf.org/2007/opf"><metadata>${metadata}</metadata></package>`,
        'application/xml',
      );
    expect(
      readSeries(
        opf(
          '<meta property="belongs-to-collection" id="set">合集</meta><meta refines="#set" property="collection-type">set</meta>' +
            '<meta property="belongs-to-collection" id="s">测试系列</meta><meta refines="#s" property="collection-type">series</meta><meta refines="#s" property="group-position">2.5</meta>' +
            '<meta name="calibre:series" content="其他"/>',
        ),
      ),
    ).toEqual({ title: '测试系列', index: 2.5 });
    expect(
      readSeries(
        opf(
          '<meta name="calibre:series" content=" 卡利伯系列 "/><meta name="calibre:series_index" content="3.0"/>',
        ),
      ),
    ).toEqual({ title: '卡利伯系列', index: 3 });
    expect(
      readSeries(
        opf(
          '<meta name="calibre:series" content="无序号"/><meta name="calibre:series_index" content="abc"/>',
        ),
      ),
    ).toEqual({ title: '无序号', index: null });
    expect(
      readSeries(opf('<meta name="calibre:series" content=" "/>')),
    ).toBeNull();
  });

  it('maps a corrupt archive to INVALID_EPUB', async () => {
    await expect(
      parser.parse(new Uint8Array([1, 2, 3]), 'broken.epub'),
    ).rejects.toMatchObject({
      code: 'INVALID_EPUB',
    } satisfies Partial<AppError>);
  });
});
