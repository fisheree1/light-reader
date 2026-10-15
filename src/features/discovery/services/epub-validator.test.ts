import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { fixtureImage } from '../../../test/fixtures/novel-gateway';
import { buildNovelEpub } from './epub-builder-service';
import { resolveHref, validateEpub } from './epub-validator';

async function build(coverPath: string | null = 'images/0.png') {
  return buildNovelEpub(
    {
      title: '测试卷',
      author: '作者',
      identifier: 'urn:test:1',
      sourceUrl: 'https://www.bilinovel.com/novel/1/vol_1.html',
      translators: ['译者'],
      script: 'hans',
      chapters: [
        {
          title: '序章',
          html: '<p>正文</p><img src="images/0.png" alt="插图" />',
        },
      ],
      images: [
        { path: 'images/0.png', mediaType: 'image/png', bytes: fixtureImage() },
      ],
      coverPath,
      missingImages: 0,
    },
    new AbortController().signal,
  );
}

/** Rebuilds a valid EPUB after changing some of its files. */
async function mutate(
  change: (files: Record<string, Uint8Array>) => void,
  mimetypeLevel: 0 | 6 = 0,
) {
  const files = unzipSync(await build());
  change(files);
  const entries: Zippable = {
    mimetype: [files.mimetype, { level: mimetypeLevel }],
  };
  for (const [path, bytes] of Object.entries(files))
    if (path !== 'mimetype') entries[path] = bytes;
  return zipSync(entries);
}

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);
const codes = async (bytes: Uint8Array) =>
  (await validateEpub(bytes)).errors.map((issue) => issue.code);

describe('EPUB structural validation', () => {
  it('accepts a built volume and warns only about a missing cover', async () => {
    expect(await validateEpub(await build())).toEqual({
      errors: [],
      warnings: [],
    });
    expect((await validateEpub(await build(null))).warnings).toEqual([
      { code: 'cover-missing' },
    ]);
  });

  it('requires an uncompressed mimetype entry first', async () => {
    expect(await codes(await mutate(() => undefined, 6))).toEqual([
      'mimetype-not-first-stored',
    ]);
    expect(await codes(strToU8('not a zip'))).toContain('zip-invalid');
  });

  it('reports broken markup, dangling references and wrong media types', async () => {
    expect(
      await codes(
        await mutate((files) => {
          files['EPUB/chapter-1.xhtml'] = strToU8(
            text(files['EPUB/chapter-1.xhtml']).replace(
              '<p>正文</p>',
              '<p>正文',
            ),
          );
        }),
      ),
    ).toEqual(['xhtml-invalid']);
    expect(
      await codes(
        await mutate((files) => {
          files['EPUB/chapter-1.xhtml'] = strToU8(
            text(files['EPUB/chapter-1.xhtml'])
              .replace('images/0.png', 'images/9.png')
              .replace('</body>', '<a href="gone.xhtml#x">x</a></body>'),
          );
        }),
      ),
    ).toEqual(['image-missing', 'link-broken']);
    expect(
      await codes(
        await mutate((files) => {
          files['EPUB/package.opf'] = strToU8(
            text(files['EPUB/package.opf'])
              .replace('media-type="image/png"', 'media-type="image/jpeg"')
              .replace('idref="c0"', 'idref="c9"'),
          );
        }),
      ),
    ).toEqual(['spine-idref-invalid', 'image-type-mismatch']);
  });

  it('reports missing manifest files, navigation and metadata', async () => {
    const result = await validateEpub(
      await mutate((files) => {
        delete files['EPUB/source.xhtml'];
        files['EPUB/extra.txt'] = strToU8('x');
        files['EPUB/package.opf'] = strToU8(
          text(files['EPUB/package.opf'])
            .replace(' properties="nav"', '')
            .replace(/<dc:language>[^<]*<\/dc:language>/, ''),
        );
      }),
    );
    expect(result.errors.map((issue) => issue.code)).toEqual([
      'metadata-language-missing',
      'manifest-file-missing',
      'spine-idref-invalid',
      'nav-missing',
      // The navigation still links to the deleted page.
      'link-broken',
    ]);
    expect(result.warnings).toEqual([
      { code: 'file-not-in-manifest', path: 'EPUB/extra.txt' },
    ]);
    expect(
      await codes(
        await mutate((files) => {
          delete files['META-INF/container.xml'];
        }),
      ),
    ).toEqual(['container-invalid']);
  });

  it('resolves hrefs inside the archive only', () => {
    expect(resolveHref('EPUB/a/b.xhtml', '../images/%E5%9B%BE.png')).toBe(
      'EPUB/images/图.png',
    );
    expect(resolveHref('EPUB/a.xhtml', 'https://example.com/x')).toBeNull();
  });
});
