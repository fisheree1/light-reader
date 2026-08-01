import { strToU8, zipSync } from 'fflate';

interface EpubFixtureOptions {
  author?: string | null;
  chapters?: { href: string; id: string; text: string; title: string }[];
  includeCover?: boolean;
  title?: string | null;
}

export function createEpubFixture({
  author = '测试作者',
  chapters = [],
  includeCover = true,
  title = '测试图书',
}: EpubFixtureOptions = {}): Uint8Array {
  const titleXml = title ? `<dc:title>${title}</dc:title>` : '';
  const authorXml = author ? `<dc:creator>${author}</dc:creator>` : '';
  const coverManifest = includeCover
    ? '<item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image" />'
    : '';
  const chapterManifest = chapters
    .map(
      (chapter) =>
        `<item id="${chapter.id}" href="${chapter.href}" media-type="application/xhtml+xml" />`,
    )
    .join('');
  const spine = chapters
    .map((chapter) => `<itemref idref="${chapter.id}" />`)
    .join('');

  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles>
      </container>`),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          ${titleXml}${authorXml}
          <dc:language>zh-CN</dc:language>
          <dc:publisher>LightReader 测试出版社</dc:publisher>
          <dc:description>自制的无版权测试 EPUB。</dc:description>
          <dc:identifier>urn:lightreader:test</dc:identifier>
        </metadata>
        <manifest>${coverManifest}${chapterManifest}</manifest>
        <spine>${spine}</spine>
      </package>`),
    ...Object.fromEntries(
      chapters.map((chapter) => [
        `OEBPS/${chapter.href}`,
        strToU8(`<?xml version="1.0"?>
          <html xmlns="http://www.w3.org/1999/xhtml">
            <head><title>${chapter.title}</title></head>
            <body><h1>${chapter.title}</h1><p>${chapter.text}</p></body>
          </html>`),
      ]),
    ),
    ...(includeCover
      ? { 'OEBPS/images/cover.png': new Uint8Array([137, 80, 78, 71]) }
      : {}),
  });
}
