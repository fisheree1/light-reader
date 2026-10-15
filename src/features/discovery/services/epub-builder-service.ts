import { strToU8, zip, type AsyncZippable } from 'fflate';
import { DiscoveryError, throwIfCancelled } from '../domain/discovery-error';
import { escapeXml } from './bilinovel-parser';

export interface EpubImage {
  path: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface EpubChapter {
  title: string;
  html: string;
}

export function detectImage(bytes: Uint8Array): {
  extension: string;
  mediaType: string;
} {
  const ascii = new TextDecoder('latin1').decode(bytes.subarray(0, 12));
  if (bytes[0] === 137 && ascii.slice(1, 4) === 'PNG')
    return { extension: 'png', mediaType: 'image/png' };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return { extension: 'jpg', mediaType: 'image/jpeg' };
  if (/^GIF8[79]a/.test(ascii))
    return { extension: 'gif', mediaType: 'image/gif' };
  if (ascii.startsWith('RIFF') && ascii.slice(8) === 'WEBP')
    return { extension: 'webp', mediaType: 'image/webp' };
  throw new DiscoveryError('SOURCE_IMAGE_FAILED');
}

export async function buildNovelEpub(
  input: {
    title: string;
    author: string;
    identifier: string;
    sourceUrl: string;
    translators: string[];
    chapters: EpubChapter[];
    images: EpubImage[];
    coverPath: string | null;
    missingImages: number;
  },
  signal: AbortSignal,
): Promise<Uint8Array> {
  throwIfCancelled(signal);
  if (!input.chapters.length || input.chapters.length > 500)
    throw new DiscoveryError('SOURCE_INCOMPLETE');
  const files: AsyncZippable = {};
  const mtime = new Date(2000, 0, 1);
  let total = 0;
  const add = (path: string, value: string | Uint8Array, level: 0 | 6 = 6) => {
    const bytes = typeof value === 'string' ? strToU8(value) : value;
    total += bytes.byteLength;
    if (total > 64 * 1024 * 1024) throw new DiscoveryError('SOURCE_TOO_LARGE');
    files[path] = [bytes, { mtime, level }];
  };
  add('mimetype', 'application/epub+zip', 0);
  add(
    'META-INF/container.xml',
    '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  const xhtml = (title: string, body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh" xml:lang="zh"><head><title>${escapeXml(title)}</title><link rel="stylesheet" href="style.css"/></head><body>${body}</body></html>`;
  add(
    'EPUB/style.css',
    'body{line-height:1.7}img{max-width:100%;height:auto}p{margin:0.6em 0}ruby{ruby-position:over}',
  );
  add(
    'EPUB/source.xhtml',
    xhtml(
      '来源信息',
      `<h1>${escapeXml(input.title)}</h1><p>${escapeXml(input.author)}</p><p>${escapeXml(input.translators.join('、'))}</p><p><a href="${escapeXml(input.sourceUrl)}">${escapeXml(input.sourceUrl)}</a></p>${input.missingImages ? `<p>缺少图片：${String(input.missingImages)}</p>` : ''}`,
    ),
  );
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="style" href="style.css" media-type="text/css"/>',
    '<item id="source" href="source.xhtml" media-type="application/xhtml+xml"/>',
  ];
  const spine = ['<itemref idref="source"/>'];
  const nav = ['<li><a href="source.xhtml">来源信息</a></li>'];
  input.chapters.forEach((chapter, index) => {
    const path = `chapter-${String(index + 1)}.xhtml`;
    add(
      `EPUB/${path}`,
      xhtml(
        chapter.title,
        `<h1>${escapeXml(chapter.title)}</h1>${chapter.html}`,
      ),
    );
    manifest.push(
      `<item id="c${String(index)}" href="${path}" media-type="application/xhtml+xml"/>`,
    );
    spine.push(`<itemref idref="c${String(index)}"/>`);
    nav.push(`<li><a href="${path}">${escapeXml(chapter.title)}</a></li>`);
  });
  input.images.forEach((image, index) => {
    add(`EPUB/${image.path}`, image.bytes, 0);
    manifest.push(
      `<item id="i${String(index)}" href="${image.path}" media-type="${image.mediaType}"${image.path === input.coverPath ? ' properties="cover-image"' : ''}/>`,
    );
  });
  add(
    'EPUB/nav.xhtml',
    xhtml(
      '目录',
      `<nav epub:type="toc" id="toc"><h1>目录</h1><ol>${nav.join('')}</ol></nav>`,
    ),
  );
  add(
    'EPUB/package.opf',
    `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${escapeXml(input.identifier)}</dc:identifier><dc:title>${escapeXml(input.title)}</dc:title><dc:creator>${escapeXml(input.author)}</dc:creator><dc:language>zh</dc:language><dc:source>${escapeXml(input.sourceUrl)}</dc:source><dc:description>${escapeXml(input.translators.join('、'))}</dc:description><meta property="dcterms:modified">2000-01-01T00:00:00Z</meta></metadata><manifest>${manifest.join('')}</manifest><spine>${spine.join('')}</spine></package>`,
  );
  return new Promise((resolve, reject) => {
    const abort = () => {
      terminate();
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    const terminate = zip(files, {}, (error, result) => {
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else if (result.byteLength > 64 * 1024 * 1024)
        reject(new DiscoveryError('SOURCE_TOO_LARGE'));
      else resolve(result);
    });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
