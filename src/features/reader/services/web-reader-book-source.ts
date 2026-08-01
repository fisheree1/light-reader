import { strToU8, zipSync } from 'fflate';

import type { ReaderBookSource } from './reader-book-source';

function createWebEpub(): ArrayBuffer {
  const entries = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
        <rootfiles><rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml" /></rootfiles>
      </container>`),
    'EPUB/content.opf': strToU8(`<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier id="id">urn:lightreader:web-fixture</dc:identifier>
          <dc:title>Web 测试 EPUB</dc:title>
          <dc:language>zh-CN</dc:language>
        </metadata>
        <manifest>
          <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
          <item id="one" href="one.xhtml" media-type="application/xhtml+xml" />
          <item id="two" href="two.xhtml" media-type="application/xhtml+xml" />
        </manifest>
        <spine><itemref idref="one" /><itemref idref="two" /></spine>
      </package>`),
    'EPUB/nav.xhtml': strToU8(`<?xml version="1.0"?>
      <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
        <head><title>目录</title></head><body><nav epub:type="toc"><ol>
          <li><a href="one.xhtml">第一章</a></li>
          <li><a href="two.xhtml">第二章</a></li>
        </ol></nav></body>
      </html>`),
    'EPUB/one.xhtml': strToU8(`<?xml version="1.0"?>
      <html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head>
      <body><h1>第一章</h1><p>这是 LightReader 自制的无版权测试内容。</p></body></html>`),
    'EPUB/two.xhtml': strToU8(`<?xml version="1.0"?>
      <html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head>
      <body><h1>第二章</h1><p>目录导航已经到达第二章。</p></body></html>`),
  };
  return Uint8Array.from(zipSync(entries)).buffer;
}

export class WebReaderBookSource implements ReaderBookSource {
  read(): Promise<ArrayBuffer> {
    return Promise.resolve(createWebEpub());
  }
}
