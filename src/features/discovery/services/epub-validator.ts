import { unzip, type Unzipped } from 'fflate';
import { detectImage } from './epub-builder-service';

/**
 * Structural checks on a built EPUB, run before it is imported. This is not
 * a full EPUBCheck: it covers the failures a scraped volume can actually
 * produce (broken markup, dangling links or images, wrong media types).
 */
export interface EpubIssue {
  code: string;
  path?: string;
  detail?: string;
}

export interface EpubValidation {
  errors: EpubIssue[];
  warnings: EpubIssue[];
}

const OPF = 'http://www.idpf.org/2007/opf';
const DC = 'http://purl.org/dc/elements/1.1/';
const OPS = 'http://www.idpf.org/2007/ops';
const MIMETYPE = 'application/epub+zip';

function unzipAsync(bytes: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(bytes, (error, files) => {
      if (error) reject(error);
      else resolve(files);
    });
  });
}

/** Resolves an href against the file that contains it, within the archive. */
export function resolveHref(from: string, href: string): string | null {
  try {
    const url = new URL(href, `https://epub.invalid/${from}`);
    if (url.origin !== 'https://epub.invalid') return null;
    return decodeURIComponent(url.pathname.slice(1));
  } catch {
    return null;
  }
}

function parseXml(text: string, type: DOMParserSupportedType) {
  const document = new DOMParser().parseFromString(text, type);
  return document.getElementsByTagName('parsererror').length ? null : document;
}

/** The first entry must be an uncompressed `mimetype` with no extra field. */
function checkMimetype(bytes: Uint8Array, errors: EpubIssue[]) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 38 || view.getUint32(0, true) !== 0x04034b50) {
    errors.push({ code: 'zip-invalid' });
    return;
  }
  const method = view.getUint16(8, true);
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const decoder = new TextDecoder();
  const name = decoder.decode(bytes.subarray(30, 30 + nameLength));
  const start = 30 + nameLength + extraLength;
  const content = decoder.decode(
    bytes.subarray(start, start + MIMETYPE.length),
  );
  if (
    name !== 'mimetype' ||
    method !== 0 ||
    extraLength !== 0 ||
    content !== MIMETYPE
  )
    errors.push({ code: 'mimetype-not-first-stored', path: name });
}

export async function validateEpub(bytes: Uint8Array): Promise<EpubValidation> {
  const errors: EpubIssue[] = [];
  const warnings: EpubIssue[] = [];
  const result = { errors, warnings };
  checkMimetype(bytes, errors);
  let files: Unzipped;
  try {
    files = await unzipAsync(bytes);
  } catch (error) {
    errors.push({ code: 'zip-invalid', detail: String(error) });
    return result;
  }
  const text = (path: string) => new TextDecoder().decode(files[path]);

  const container =
    'META-INF/container.xml' in files
      ? parseXml(text('META-INF/container.xml'), 'application/xml')
      : null;
  const opfPath = container
    ?.getElementsByTagName('rootfile')[0]
    ?.getAttribute('full-path');
  if (!opfPath || !(opfPath in files)) {
    errors.push({ code: 'container-invalid', path: 'META-INF/container.xml' });
    return result;
  }
  const opf = parseXml(text(opfPath), 'application/xml');
  if (!opf) {
    errors.push({ code: 'xml-invalid', path: opfPath });
    return result;
  }

  const identifierId = opf.documentElement.getAttribute('unique-identifier');
  const identifiers = [...opf.getElementsByTagNameNS(DC, 'identifier')];
  if (!identifiers.some((node) => node.getAttribute('id') === identifierId))
    errors.push({ code: 'identifier-missing', path: opfPath });
  for (const name of ['title', 'language'])
    if (!opf.getElementsByTagNameNS(DC, name).item(0)?.textContent.trim())
      errors.push({ code: `metadata-${name}-missing`, path: opfPath });
  if (
    ![...opf.getElementsByTagNameNS(OPF, 'meta')].some(
      (node) => node.getAttribute('property') === 'dcterms:modified',
    )
  )
    errors.push({ code: 'metadata-modified-missing', path: opfPath });

  const manifest = new Map<
    string,
    { path: string; type: string; properties: string[] }
  >();
  for (const item of opf.getElementsByTagNameNS(OPF, 'item')) {
    const id = item.getAttribute('id') ?? '';
    const href = item.getAttribute('href') ?? '';
    const path = resolveHref(opfPath, href);
    if (!id || manifest.has(id)) {
      errors.push({ code: 'manifest-id-invalid', path: href });
      continue;
    }
    if (!path || !(path in files)) {
      errors.push({ code: 'manifest-file-missing', path: href });
      continue;
    }
    manifest.set(id, {
      path,
      type: item.getAttribute('media-type') ?? '',
      properties: (item.getAttribute('properties') ?? '').split(/\s+/),
    });
  }
  const listed = new Set([...manifest.values()].map((item) => item.path));
  for (const path of Object.keys(files))
    if (
      !path.endsWith('/') &&
      path !== 'mimetype' &&
      path !== opfPath &&
      !path.startsWith('META-INF/') &&
      !listed.has(path)
    )
      warnings.push({ code: 'file-not-in-manifest', path });

  const spine = [...opf.getElementsByTagNameNS(OPF, 'itemref')];
  if (!spine.length) errors.push({ code: 'spine-empty', path: opfPath });
  for (const itemref of spine) {
    const item = manifest.get(itemref.getAttribute('idref') ?? '');
    if (!item)
      errors.push({
        code: 'spine-idref-invalid',
        detail: itemref.getAttribute('idref') ?? '',
      });
    else if (item.type !== 'application/xhtml+xml')
      errors.push({ code: 'spine-not-xhtml', path: item.path });
  }

  const navItems = [...manifest.values()].filter((item) =>
    item.properties.includes('nav'),
  );
  if (navItems.length !== 1)
    errors.push({ code: 'nav-missing', path: opfPath });
  if (
    ![...manifest.values()].some((item) =>
      item.properties.includes('cover-image'),
    )
  )
    warnings.push({ code: 'cover-missing' });

  for (const item of manifest.values()) {
    if (item.type.startsWith('image/')) {
      try {
        if (detectImage(files[item.path]).mediaType !== item.type)
          errors.push({
            code: 'image-type-mismatch',
            path: item.path,
            detail: item.type,
          });
      } catch {
        errors.push({ code: 'image-unreadable', path: item.path });
      }
      continue;
    }
    if (item.type !== 'application/xhtml+xml') continue;
    const document = parseXml(text(item.path), 'application/xhtml+xml');
    if (!document) {
      errors.push({ code: 'xhtml-invalid', path: item.path });
      continue;
    }
    const references = [
      ...[...document.getElementsByTagName('img')].map((node) => ({
        href: node.getAttribute('src') ?? '',
        image: true,
      })),
      ...[...document.getElementsByTagName('a')]
        .map((node) => node.getAttribute('href') ?? '')
        .filter((href) => href && !/^[a-z][a-z0-9+.-]*:/i.test(href))
        .map((href) => ({ href: href.split('#')[0], image: false })),
      ...[...document.getElementsByTagName('link')].map((node) => ({
        href: node.getAttribute('href') ?? '',
        image: false,
      })),
    ];
    for (const reference of references) {
      if (!reference.href) continue;
      const target = resolveHref(item.path, reference.href);
      if (!target || !listed.has(target))
        errors.push({
          code: reference.image ? 'image-missing' : 'link-broken',
          path: item.path,
          detail: reference.href,
        });
    }
    if (item.properties.includes('nav')) {
      const toc = [...document.getElementsByTagName('nav')].find(
        (node) => node.getAttributeNS(OPS, 'type') === 'toc',
      );
      if (!toc?.getElementsByTagName('a').length)
        errors.push({ code: 'nav-toc-empty', path: item.path });
    }
  }
  return result;
}
