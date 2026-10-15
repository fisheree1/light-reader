import {
  createCbzFixture,
  createFb2Fixture,
  createMobiSignature,
  onePixelPng,
} from '../../../test/fixtures/foliate-fixtures';
import type { FoliateBook } from '../../../reader-engines/foliate-book-loader';
import {
  assertFoliateBookSignature,
  FoliateBookMetadataParser,
} from './foliate-metadata-parser';

describe('assertFoliateBookSignature', () => {
  it('accepts matching content for every Foliate format', () => {
    expect(() => {
      assertFoliateBookSignature(createMobiSignature(), 'mobi');
      assertFoliateBookSignature(createMobiSignature(), 'azw3');
      assertFoliateBookSignature(createFb2Fixture(), 'fb2');
      assertFoliateBookSignature(createCbzFixture(), 'cbz');
    }).not.toThrow();
  });

  it('rejects files whose content does not match the extension', () => {
    for (const [source, format] of [
      [createFb2Fixture(), 'mobi'],
      [createMobiSignature(), 'fb2'],
      [createFb2Fixture(), 'cbz'],
      [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]), 'cbz'],
    ] as const) {
      expect(() => {
        assertFoliateBookSignature(source, format);
      }).toThrow(expect.objectContaining({ code: 'INVALID_EBOOK' }));
    }
  });
});

describe('FoliateBookMetadataParser', () => {
  it('maps Foliate metadata, authors, and a sniffed cover', async () => {
    const destroy = vi.fn();
    const book: FoliateBook = {
      metadata: {
        title: { zh: '多语言书名' },
        author: [{ name: '作者甲' }, '作者乙'],
        language: ['zh'],
        publisher: '出版社',
        description: '<p>简介 <b>内容</b></p>',
        identifier: 'id-1',
      },
      getCover: () => Promise.resolve(new Blob([onePixelPng])),
      destroy,
    };
    const parser = new FoliateBookMetadataParser(() => Promise.resolve(book));

    const parsed = await parser.parse(createMobiSignature(), 'x.mobi', 'mobi');

    expect(parsed.metadata).toEqual({
      title: '多语言书名',
      creators: ['作者甲', '作者乙'],
      language: 'zh',
      publisher: '出版社',
      description: '简介 内容',
      identifier: 'id-1',
    });
    expect(parsed.cover).toMatchObject({
      extension: 'png',
      mediaType: 'image/png',
    });
    expect(destroy).toHaveBeenCalled();
  });

  it('falls back to the file name and skips unusable covers', async () => {
    const parser = new FoliateBookMetadataParser(() =>
      Promise.resolve({
        metadata: { title: 'book.cbz' },
        getCover: () => Promise.reject(new Error('broken cover')),
      }),
    );

    await expect(
      parser.parse(createCbzFixture(), '我的漫画.cbz', 'cbz'),
    ).resolves.toMatchObject({
      metadata: { title: '我的漫画', creators: [] },
      cover: null,
    });
  });

  it('reports parser failures as invalid books', async () => {
    const parser = new FoliateBookMetadataParser(() =>
      Promise.reject(new Error('corrupt')),
    );

    await expect(
      parser.parse(createMobiSignature(), 'x.azw3', 'azw3'),
    ).rejects.toMatchObject({ code: 'INVALID_EBOOK' });
  });

  it('parses a real FB2 document through Foliate', async () => {
    const parsed = await new FoliateBookMetadataParser().parse(
      createFb2Fixture(),
      'fixture.fb2',
      'fb2',
    );

    expect(parsed.metadata).toMatchObject({
      title: 'FB2 测试书',
      creators: ['Lu Xun'],
      language: 'zh',
      publisher: 'LightReader',
    });
  });
});
