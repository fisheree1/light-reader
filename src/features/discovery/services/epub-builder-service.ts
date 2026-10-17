import { strToU8, zip, type AsyncZippable } from 'fflate';
import { DiscoveryError, throwIfCancelled } from '../domain/discovery-error';
import type { ChineseScript } from '../domain/chinese-script';
import type { TranslationMethod } from '../domain/edition';
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
    script?: ChineseScript;
    translationMethod?: TranslationMethod;
    edition?: string | null;
    series?: { title: string; index: number } | null;
    /** BCP 47 language for an untranslated original, such as `ja`. */
    language?: string;
    /** Vertical writing, right to left (縦書き). */
    vertical?: boolean;
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
  const original = input.language !== undefined;
  const language =
    input.language ??
    (input.script === 'hans'
      ? 'zh-Hans'
      : input.script === 'hant'
        ? 'zh-Hant'
        : 'zh');
  const xhtml = (title: string, body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${language}" xml:lang="${language}"><head><title>${escapeXml(title)}</title><link rel="stylesheet" href="style.css"/></head><body>${body}</body></html>`;
  add(
    'EPUB/style.css',
    'body{line-height:1.7}img{max-width:100%;height:auto}p{margin:0.6em 0}ruby{ruby-position:over}' +
      (original
        ? 'p{margin:0}.afterword,.preface{margin:2em 0;opacity:.8}'
        : '') +
      (input.vertical
        ? 'html{writing-mode:vertical-rl;-webkit-writing-mode:vertical-rl;-epub-writing-mode:vertical-rl}'
        : ''),
  );
  const methodLabel = {
    human: '人工翻译',
    machine: '机器翻译',
    mixed: '人工与机器混合',
    unknown: '未知（来源未声明）',
  }[input.translationMethod ?? 'unknown'];
  const detail = (label: string, value: string) =>
    `<p>${escapeXml(label)}：${escapeXml(value)}</p>`;
  add(
    'EPUB/source.xhtml',
    xhtml(
      '来源信息',
      [
        `<h1>${escapeXml(input.title)}</h1>`,
        detail('作者', input.author),
        ...(original
          ? []
          : [
              detail(
                '译者',
                input.translators.join('、') || '未知（来源未声明）',
              ),
              detail('翻译类型', methodLabel),
            ]),
        input.edition ? detail('版本', input.edition) : '',
        `<p><a href="${escapeXml(input.sourceUrl)}">${escapeXml(input.sourceUrl)}</a></p>`,
        input.missingImages
          ? detail('缺少图片', String(input.missingImages))
          : '',
      ].join(''),
    ),
  );
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="style" href="style.css" media-type="text/css"/>',
    '<item id="source" href="source.xhtml" media-type="application/xhtml+xml"/>',
  ];
  // The story comes first; the source page closes the book, like a colophon.
  const spine: string[] = [];
  const nav: string[] = [];
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
  spine.push('<itemref idref="source"/>');
  nav.push('<li><a href="source.xhtml">来源信息</a></li>');
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
      `<nav epub:type="toc" id="toc"><h1>目录</h1><ol>${nav.join('')}</ol></nav>` +
        // Readers open a new book at the start of the text.
        '<nav epub:type="landmarks" id="landmarks" hidden="hidden"><ol><li><a epub:type="bodymatter" href="chapter-1.xhtml">正文</a></li></ol></nav>',
    ),
  );
  // EPUB 3 marks translators with a MARC relator refinement.
  const contributors = input.translators
    .map(
      (translator, index) =>
        `<dc:contributor id="trl${String(index)}">${escapeXml(translator)}</dc:contributor><meta refines="#trl${String(index)}" property="role" scheme="marc:relators">trl</meta>`,
    )
    .join('');
  // EPUB 3 collection plus Calibre's meta, which most other readers use.
  const series = input.series
    ? `<meta property="belongs-to-collection" id="series">${escapeXml(input.series.title)}</meta><meta refines="#series" property="collection-type">series</meta><meta refines="#series" property="group-position">${String(input.series.index)}</meta><meta name="calibre:series" content="${escapeXml(input.series.title)}"/><meta name="calibre:series_index" content="${String(input.series.index)}"/>`
    : '';
  add(
    'EPUB/package.opf',
    `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${escapeXml(input.identifier)}</dc:identifier><dc:title>${escapeXml(input.title)}</dc:title><dc:creator>${escapeXml(input.author)}</dc:creator><dc:language>${language}</dc:language><dc:source>${escapeXml(input.sourceUrl)}</dc:source>${contributors}${series}<meta property="dcterms:modified">2000-01-01T00:00:00Z</meta></metadata><manifest>${manifest.join('')}</manifest><spine${input.vertical ? ' page-progression-direction="rtl"' : ''}>${spine.join('')}</spine></package>`,
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
