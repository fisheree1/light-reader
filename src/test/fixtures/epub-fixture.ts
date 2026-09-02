import { strToU8, zipSync } from 'fflate';

export interface EpubFixtureOptions {
  author?: string | null;
  chapters?: { href: string; id: string; text: string; title: string }[];
  includeCover?: boolean;
  packagePath?: string;
  pageProgressionDirection?: 'ltr' | 'rtl';
  renditionLayout?: 'pre-paginated' | 'reflowable';
  title?: string | null;
}

export function createEpubFixture({
  author = '测试作者',
  chapters = [],
  includeCover = true,
  packagePath = 'OEBPS/content.opf',
  pageProgressionDirection,
  renditionLayout,
  title = '测试图书',
}: EpubFixtureOptions = {}): Uint8Array {
  const packageDirectory = packagePath.includes('/')
    ? packagePath.slice(0, packagePath.lastIndexOf('/') + 1)
    : '';
  const titleXml = title ? `<dc:title>${title}</dc:title>` : '';
  const authorXml = author ? `<dc:creator>${author}</dc:creator>` : '';
  const layoutXml = renditionLayout
    ? `<meta property="rendition:layout">${renditionLayout}</meta>`
    : '';
  const coverManifest = includeCover
    ? '<item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image" />'
    : '';
  const chapterManifest = chapters
    .map(
      (chapter) =>
        `<item id="${chapter.id}" href="${chapter.href}" media-type="application/xhtml+xml" />`,
    )
    .join('');
  const spineItems = chapters
    .map((chapter) => `<itemref idref="${chapter.id}" />`)
    .join('');
  const spineDirection = pageProgressionDirection
    ? ` page-progression-direction="${pageProgressionDirection}"`
    : '';
  const documentDirection = pageProgressionDirection
    ? ` dir="${pageProgressionDirection}"`
    : '';
  const viewport =
    renditionLayout === 'pre-paginated'
      ? '<meta name="viewport" content="width=1200,height=1600" />'
      : '';

  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="${packagePath}" media-type="application/oebps-package+xml" /></rootfiles>
      </container>`),
    [packagePath]: strToU8(`<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          ${titleXml}${authorXml}
          <dc:language>zh-CN</dc:language>
          <dc:publisher>LightReader 测试出版社</dc:publisher>
          <dc:description>自制的无版权测试 EPUB。</dc:description>
          <dc:identifier>urn:lightreader:test</dc:identifier>
          ${layoutXml}
        </metadata>
        <manifest>${coverManifest}${chapterManifest}</manifest>
        <spine${spineDirection}>${spineItems}</spine>
      </package>`),
    ...Object.fromEntries(
      chapters.map((chapter) => [
        `${packageDirectory}${chapter.href}`,
        strToU8(`<?xml version="1.0"?>
          <html xmlns="http://www.w3.org/1999/xhtml"${documentDirection}>
            <head><title>${chapter.title}</title>${viewport}</head>
            <body><h1>${chapter.title}</h1><p>${chapter.text}</p></body>
          </html>`),
      ]),
    ),
    ...(includeCover
      ? {
          [`${packageDirectory}images/cover.png`]: new Uint8Array([
            137, 80, 78, 71,
          ]),
        }
      : {}),
  });
}
