import type { BookImporter } from '../../library/services/book-import-service';
import type { ContentHasher } from '../../../platform/crypto/content-hasher';
import type {
  AcquisitionProgress,
  NovelCatalogue,
  NovelGateway,
  NovelSource,
  NovelVolume,
} from '../domain/catalog';
import { DiscoveryError, throwIfCancelled } from '../domain/discovery-error';
import {
  isSearchPath,
  pagePath,
  parseCatalogue,
  parseChapter,
  parseSearch,
  sourceUrl,
} from './bilinovel-parser';
import {
  buildNovelEpub,
  detectImage,
  type EpubChapter,
  type EpubImage,
} from './epub-builder-service';

export class BookDiscoveryService {
  readonly gateway: NovelGateway;
  private readonly importer: BookImporter;
  private readonly hasher: ContentHasher;
  constructor(
    gateway: NovelGateway,
    importer: BookImporter,
    hasher: ContentHasher,
  ) {
    this.gateway = gateway;
    this.importer = importer;
    this.hasher = hasher;
  }

  async search(source: NovelSource, query: string, signal: AbortSignal) {
    const normalized = query.trim();
    if (!normalized || normalized.length > 100)
      throw new DiscoveryError('SOURCE_INVALID');
    const snapshot = await this.gateway.readPage(
      source,
      { kind: 'search', query: normalized },
      signal,
    );
    throwIfCancelled(signal);
    return parseSearch(source, snapshot);
  }

  async catalogue(source: NovelSource, id: string, signal: AbortSignal) {
    if (!/^\d{1,10}$/.test(id)) throw new DiscoveryError('SOURCE_INVALID');
    const snapshot = await this.gateway.readPage(
      source,
      { kind: 'page', path: `/novel/${id}/catalog` },
      signal,
    );
    throwIfCancelled(signal);
    return parseCatalogue(source, snapshot, id);
  }

  async current(source: NovelSource, signal: AbortSignal) {
    const snapshot = await this.gateway.readPage(
      source,
      { kind: 'current' },
      signal,
    );
    throwIfCancelled(signal);
    const path = new URL(snapshot.url).pathname;
    if (
      !isSearchPath(path) &&
      !/^\/novel\/\d{1,10}(?:\.html|\/catalog)$/.test(path)
    )
      throw new DiscoveryError('SOURCE_SELECT_BOOK');
    return parseSearch(source, snapshot);
  }

  async acquire(
    input: {
      source: NovelSource;
      catalogue: NovelCatalogue;
      volume: NovelVolume;
      allowMissingImages: boolean;
      onProgress: (progress: AcquisitionProgress) => void;
    },
    signal: AbortSignal,
  ) {
    const { source, catalogue, volume, onProgress } = input;
    if (!this.importer.importBytes)
      throw new DiscoveryError('SOURCE_UNAVAILABLE');
    if (
      !volume.chapters.length ||
      volume.unavailableChapters ||
      volume.contentKind !== 'novel'
    )
      throw new DiscoveryError('SOURCE_INCOMPLETE');
    const images: EpubImage[] = [];
    const imageCache = new Map<string, string | null>();
    const chapters: EpubChapter[] = [];
    const translators = new Set<string>();
    let bytesTotal = 0;
    let missingImages = 0;
    const budget = (bytes: number) => {
      bytesTotal += bytes;
      if (bytesTotal > 64 * 1024 * 1024)
        throw new DiscoveryError('SOURCE_TOO_LARGE');
    };
    const loadImage = async (url: string): Promise<string | null> => {
      throwIfCancelled(signal);
      if (imageCache.has(url)) return imageCache.get(url) ?? null;
      if (imageCache.size >= 250) throw new DiscoveryError('SOURCE_TOO_LARGE');
      imageCache.set(url, null);
      try {
        const bytes = await this.gateway.readImage(source, url, signal);
        throwIfCancelled(signal);
        if (bytes.byteLength > 10 * 1024 * 1024)
          throw new DiscoveryError('SOURCE_TOO_LARGE');
        budget(bytes.byteLength);
        const format = detectImage(bytes);
        const path = `images/${String(images.length)}.${format.extension}`;
        images.push({ path, mediaType: format.mediaType, bytes });
        imageCache.set(url, path);
        return path;
      } catch (error) {
        throwIfCancelled(signal);
        if (
          error instanceof DiscoveryError &&
          error.code === 'SOURCE_TOO_LARGE'
        )
          throw error;
        if (!input.allowMissingImages)
          throw new DiscoveryError('SOURCE_IMAGE_FAILED', { cause: error });
        missingImages += 1;
        return null;
      }
    };
    if (volume.coverUrl)
      onProgress({ stage: 'images', completed: 0, total: 1 });
    const coverPath = volume.coverUrl ? await loadImage(volume.coverUrl) : null;
    for (const [index, chapter] of volume.chapters.entries()) {
      throwIfCancelled(signal);
      onProgress({
        stage: 'fetching',
        completed: index,
        total: volume.chapters.length,
      });
      let path: string | null = chapter.path;
      let resolvedTitle = chapter.title;
      const pages: string[] = [];
      const visited = new Set<string>();
      while (path) {
        throwIfCancelled(signal);
        if (visited.has(path) || visited.size >= 20)
          throw new DiscoveryError('SOURCE_INCOMPLETE');
        visited.add(path);
        const snapshot = await this.gateway.readPage(
          source,
          { kind: 'page', path },
          signal,
        );
        throwIfCancelled(signal);
        const parsed = parseChapter(source, snapshot, path);
        // Catalogue labels can contain the source's substituted characters.
        // Its rendered chapter page supplies the actual readable heading.
        if (visited.size === 1 && parsed.title) resolvedTitle = parsed.title;
        const replacements: (string | null)[] = [];
        for (const [imageIndex, url] of parsed.images.entries()) {
          onProgress({
            stage: 'images',
            completed: imageIndex,
            total: parsed.images.length,
          });
          replacements.push(await loadImage(url));
        }
        const html = parsed.html.replace(
          /<img src="image:(\d+)" alt="([^"]*)" \/>/g,
          (_match, indexText: string, alt: string) => {
            const image = replacements[Number(indexText)];
            return image
              ? `<img src="${image}" alt="${alt}" />`
              : '<p>[图片未能获取]</p>';
          },
        );
        budget(new TextEncoder().encode(html).byteLength);
        pages.push(html);
        parsed.translators.forEach((translator) => translators.add(translator));
        path = parsed.nextPath ? pagePath(source, parsed.nextPath) : null;
      }
      chapters.push({ title: resolvedTitle, html: pages.join('\n') });
      onProgress({
        stage: 'fetching',
        completed: index + 1,
        total: volume.chapters.length,
      });
    }
    throwIfCancelled(signal);
    onProgress({ stage: 'building', completed: 0, total: 1 });
    const imageHashes: string[] = [];
    for (const image of images)
      imageHashes.push(await this.hasher.sha256(image.bytes));
    const revision = await this.hasher.sha256(
      new TextEncoder().encode(JSON.stringify({ chapters, imageHashes })),
    );
    const origin = {
      source,
      novelId: catalogue.id,
      volumeId: volume.id,
      url: sourceUrl(source, `/novel/${catalogue.id}/vol_${volume.id}.html`),
      revision,
      translators: [...translators],
    };
    const bytes = await buildNovelEpub(
      {
        title: volume.title,
        author: catalogue.author,
        identifier: `urn:lightreader:${source}:${catalogue.id}:${volume.id}:${revision}`,
        sourceUrl: origin.url,
        translators: origin.translators,
        chapters,
        images,
        coverPath,
        missingImages,
      },
      signal,
    );
    throwIfCancelled(signal);
    onProgress({ stage: 'importing', completed: 0, total: 1 });
    const result = await this.importer.importBytes(
      `${volume.title}.epub`,
      bytes,
      origin,
    );
    return { ...result, missingImages };
  }
}
