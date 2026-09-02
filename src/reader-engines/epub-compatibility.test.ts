import { strFromU8, unzipSync } from 'fflate';

import { AppError } from '../lib/app-error';
import {
  FflateEpubMetadataParser,
  readEpubPackage,
} from '../features/library/services/epub-metadata-parser';
import { FflateEpubContentParser } from '../features/search/services/epub-content-parser';
import { createEpubFixture } from '../test/fixtures/epub-fixture';

describe('EPUB compatibility fixtures', () => {
  it('preserves RTL reading order and document direction', async () => {
    const fixture = createEpubFixture({
      pageProgressionDirection: 'rtl',
      chapters: [
        {
          id: 'rtl',
          href: 'Text/rtl.xhtml',
          title: 'فصل',
          text: 'هذا نص تجريبي بلا حقوق.',
        },
      ],
    });
    const { opf } = readEpubPackage(fixture);
    const entries = unzipSync(fixture);

    expect(
      opf
        .getElementsByTagNameNS('*', 'spine')
        .item(0)
        ?.getAttribute('page-progression-direction'),
    ).toBe('rtl');
    expect(
      strFromU8(entries['OEBPS/Text/rtl.xhtml'] ?? new Uint8Array()),
    ).toContain('dir="rtl"');
    await expect(new FflateEpubContentParser().parse(fixture)).resolves.toEqual(
      [
        expect.objectContaining({
          chapterHref: 'OEBPS/Text/rtl.xhtml',
          chapterTitle: 'فصل',
        }),
      ],
    );
  });

  it('recognizes a fixed-layout package with viewport metadata', () => {
    const fixture = createEpubFixture({
      renditionLayout: 'pre-paginated',
      chapters: [
        {
          id: 'fixed',
          href: 'fixed.xhtml',
          title: 'Fixed page',
          text: 'A fixed-layout compatibility page.',
        },
      ],
    });
    const { opf } = readEpubPackage(fixture);
    const entries = unzipSync(fixture);
    const layout = Array.from(opf.getElementsByTagNameNS('*', 'meta')).find(
      (meta) => meta.getAttribute('property') === 'rendition:layout',
    );

    expect(layout?.textContent).toBe('pre-paginated');
    expect(
      strFromU8(entries['OEBPS/fixed.xhtml'] ?? new Uint8Array()),
    ).toContain('width=1200,height=1600');
  });

  it('resolves a deeply nested package, chapters, and cover', async () => {
    const fixture = createEpubFixture({
      packagePath: 'OPS/deep/package/content.opf',
      chapters: [
        {
          id: 'deep',
          href: 'Text/levels/one.xhtml',
          title: 'Deep chapter',
          text: 'Nested EPUB content remains readable.',
        },
      ],
    });

    await expect(
      new FflateEpubMetadataParser().parse(fixture, 'deep.epub'),
    ).resolves.toMatchObject({
      cover: { extension: 'png' },
      metadata: { title: '测试图书' },
    });
    const [chapter] = await new FflateEpubContentParser().parse(fixture);
    expect(chapter.chapterHref).toBe('OPS/deep/package/Text/levels/one.xhtml');
    expect(chapter.text).toContain('Nested EPUB content remains readable.');
  });

  it('keeps the end of a large chapter and rejects a truncated archive', async () => {
    const largeText = `${'Large compatibility paragraph. '.repeat(12_000)}END-MARKER`;
    const fixture = createEpubFixture({
      chapters: [
        {
          id: 'large',
          href: 'large.xhtml',
          title: 'Large chapter',
          text: largeText,
        },
      ],
    });
    const chapters = await new FflateEpubContentParser().parse(fixture);

    expect(chapters[0]?.text).toContain('END-MARKER');
    await expect(
      new FflateEpubMetadataParser().parse(
        fixture.slice(0, Math.max(0, fixture.length - 32)),
        'truncated.epub',
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_EPUB',
    } satisfies Partial<AppError>);
  });
});
