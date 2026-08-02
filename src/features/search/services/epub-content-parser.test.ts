import { AppError } from '../../../lib/app-error';
import { createEpubFixture } from '../../../test/fixtures/epub-fixture';
import { FflateEpubContentParser } from './epub-content-parser';

describe('FflateEpubContentParser', () => {
  const parser = new FflateEpubContentParser();

  it('extracts searchable Chinese and English text in spine order', async () => {
    const chapters = await parser.parse(
      createEpubFixture({
        chapters: [
          {
            id: 'one',
            href: 'one.xhtml',
            title: '第一章 本地阅读',
            text: '这是中文搜索内容。',
          },
          {
            id: 'two',
            href: 'two.xhtml',
            title: 'Chapter Two',
            text: 'Local search stays on this device.',
          },
        ],
      }),
    );

    expect(chapters).toEqual([
      {
        chapterHref: 'OEBPS/one.xhtml',
        chapterTitle: '第一章 本地阅读',
        text: '第一章 本地阅读 这是中文搜索内容。',
      },
      {
        chapterHref: 'OEBPS/two.xhtml',
        chapterTitle: 'Chapter Two',
        text: 'Chapter Two Local search stays on this device.',
      },
    ]);
  });

  it('handles a large chapter without dropping text near the end', async () => {
    const largeText = `${'大量本地文本 '.repeat(30_000)}最终检索标记`;
    const [chapter] = await parser.parse(
      createEpubFixture({
        chapters: [
          {
            id: 'large',
            href: 'large.xhtml',
            title: '大型章节',
            text: largeText,
          },
        ],
      }),
    );

    expect(chapter.text.length).toBeGreaterThan(100_000);
    expect(chapter.text).toContain('最终检索标记');
  });

  it('rejects malformed EPUB data as an index error', async () => {
    await expect(parser.parse(new Uint8Array([1, 2, 3]))).rejects.toMatchObject(
      {
        code: 'INVALID_EPUB',
      } satisfies Partial<AppError>,
    );
  });

  it('rejects a highly compressed oversized chapter before extraction', async () => {
    await expect(
      parser.parse(
        createEpubFixture({
          chapters: [
            {
              id: 'bomb',
              href: 'bomb.xhtml',
              title: 'Compressed chapter',
              text: 'x'.repeat(2 * 1024 * 1024),
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      code: 'EPUB_TOO_LARGE',
    } satisfies Partial<AppError>);
  });
});
