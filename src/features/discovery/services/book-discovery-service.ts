import type { BookImporter } from '../../library/services/book-import-service';
import type { ContentHasher } from '../../../platform/crypto/content-hasher';
import type {
  AcquisitionProgress,
  NovelCatalogue,
  NovelGateway,
  NovelSource,
  NovelVolume,
} from '../domain/catalog';
import type { ParsedChapter } from '../domain/catalog';
import {
  detectChineseScript,
  normalizeTitleKey,
  searchQueryVariants,
} from '../domain/chinese-script';
import {
  combineTranslationMethods,
  type TranslationMethod,
} from '../domain/edition';
import {
  DiscoveryError,
  isSourceRefusal,
  throwIfCancelled,
} from '../domain/discovery-error';
import {
  isSearchPath,
  pagePath,
  parseCatalogue,
  parseChapter,
  parseSearch,
  sourceUrl,
} from './bilinovel-parser';
import {
  EpubValidationError,
  shortChapters,
  textLength,
  type AcquisitionReport,
  type ChapterReport,
} from '../domain/acquisition-report';
import { validateEpub } from './epub-validator';
import {
  buildNovelEpub,
  detectImage,
  type EpubChapter,
  type EpubImage,
} from './epub-builder-service';

/** A work found at one source. */
export interface SourcedNovel {
  id: string;
  source: NovelSource;
  title: string;
  url: string;
}

/**
 * Works from different sources whose normalized titles match. They are
 * candidates only: entries are never merged, and each keeps its own source,
 * IDs and catalogue.
 */
export interface SeriesCandidate {
  key: string;
  title: string;
  entries: SourcedNovel[];
}

export interface SourceSearchFailure {
  error: unknown;
  source: NovelSource;
}

export interface MultiSourceSearchResult {
  failures: SourceSearchFailure[];
  groups: SeriesCandidate[];
}

/** Groups works by normalized title, keeping first-seen order. */
export function groupBySeries(
  novels: readonly SourcedNovel[],
): SeriesCandidate[] {
  const groups = new Map<string, SeriesCandidate>();
  for (const novel of novels) {
    const key = normalizeTitleKey(novel.title) || `${novel.source}:${novel.id}`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { key, title: novel.title, entries: [novel] });
    } else if (
      !group.entries.some(
        (entry) => entry.source === novel.source && entry.id === novel.id,
      )
    ) {
      group.entries.push(novel);
    }
  }
  return [...groups.values()];
}

/** How long to stop contacting a source after it reports rate limiting. */
export const RATE_LIMIT_COOLDOWN_MS = 2 * 60 * 1000;
/** Volumes whose fetched pages are kept for a retry in this session. */
const CACHED_VOLUMES = 2;

/**
 * Pages and image bytes already fetched for one volume. A retry after a
 * failure or cancellation reuses them instead of loading them again.
 */
interface VolumeFetchCache {
  images: Map<string, Uint8Array>;
  pages: Map<string, ParsedChapter>;
}

export class BookDiscoveryService {
  readonly gateway: NovelGateway;
  private readonly importer: BookImporter;
  private readonly hasher: ContentHasher;
  private readonly now: () => number;
  private readonly fetchCache = new Map<string, VolumeFetchCache>();
  private coolingDownUntil = 0;
  constructor(
    gateway: NovelGateway,
    importer: BookImporter,
    hasher: ContentHasher,
    options: { now?: () => number } = {},
  ) {
    this.gateway = gateway;
    this.importer = importer;
    this.hasher = hasher;
    this.now = options.now ?? Date.now;
  }

  /**
   * Runs one source request plus its parsing. Nothing here retries: after a
   * rate-limit response every request is refused locally for a while, and a
   * refusal always propagates so the caller stops its task.
   */
  private async fromSource<T>(action: () => Promise<T>): Promise<T> {
    if (this.now() < this.coolingDownUntil)
      throw new DiscoveryError('SOURCE_COOLING_DOWN');
    try {
      return await action();
    } catch (error) {
      if (
        error instanceof DiscoveryError &&
        error.code === 'SOURCE_RATE_LIMITED'
      )
        this.coolingDownUntil = this.now() + RATE_LIMIT_COOLDOWN_MS;
      throw error;
    }
  }

  private volumeCache(key: string): VolumeFetchCache {
    let cache = this.fetchCache.get(key);
    if (cache) {
      // Refresh recency for the bounded LRU below.
      this.fetchCache.delete(key);
    } else {
      cache = { images: new Map(), pages: new Map() };
    }
    this.fetchCache.set(key, cache);
    while (this.fetchCache.size > CACHED_VOLUMES) {
      const oldest = this.fetchCache.keys().next().value;
      if (oldest === undefined) break;
      this.fetchCache.delete(oldest);
    }
    return cache;
  }

  async search(source: NovelSource, query: string, signal: AbortSignal) {
    const normalized = query.trim();
    if (!normalized || normalized.length > 100)
      throw new DiscoveryError('SOURCE_INVALID');
    return this.fromSource(async () => {
      const snapshot = await this.gateway.readPage(
        source,
        { kind: 'search', query: normalized },
        signal,
      );
      throwIfCancelled(signal);
      return parseSearch(source, snapshot);
    });
  }

  /**
   * Searches each source in turn. The other script's spelling is tried only
   * when the typed spelling finds nothing, so a hit costs one request per
   * source. A failing source does not hide the others' results.
   */
  async searchSources(
    sources: readonly NovelSource[],
    query: string,
    signal: AbortSignal,
  ): Promise<MultiSourceSearchResult> {
    const variants = searchQueryVariants(query);
    const found: SourcedNovel[] = [];
    const failures: SourceSearchFailure[] = [];
    for (const source of sources) {
      throwIfCancelled(signal);
      try {
        let results = await this.search(source, variants[0], signal);
        if (results.length === 0 && variants[1])
          results = await this.search(source, variants[1], signal);
        found.push(...results.map((result) => ({ ...result, source })));
      } catch (error) {
        throwIfCancelled(signal);
        failures.push({ source, error });
      }
    }
    if (failures.length === sources.length && failures[0])
      throw failures[0].error;
    return { groups: groupBySeries(found), failures };
  }

  /**
   * Searches every source with each of a work's titles (for example the
   * Chinese titles Bangumi lists), merging the results. A refusal stops the
   * remaining titles; a source failing for every title is reported once.
   */
  async searchByNames(
    sources: readonly NovelSource[],
    names: readonly string[],
    signal: AbortSignal,
  ): Promise<MultiSourceSearchResult> {
    const found: SourcedNovel[] = [];
    const failures = new Map<NovelSource, SourceSearchFailure>();
    const succeeded = new Set<NovelSource>();
    for (const name of names) {
      throwIfCancelled(signal);
      let result: MultiSourceSearchResult;
      try {
        result = await this.searchSources(sources, name, signal);
      } catch (error) {
        throwIfCancelled(signal);
        for (const source of sources) failures.set(source, { source, error });
        if (isSourceRefusal(error)) break;
        continue;
      }
      found.push(...result.groups.flatMap((group) => group.entries));
      for (const failure of result.failures)
        failures.set(failure.source, failure);
      for (const source of sources)
        if (!result.failures.some((failure) => failure.source === source))
          succeeded.add(source);
      if (result.failures.some((failure) => isSourceRefusal(failure.error)))
        break;
    }
    const remaining = [...failures.values()].filter(
      (failure) => !succeeded.has(failure.source),
    );
    if (!found.length && remaining.length === sources.length && remaining[0])
      throw remaining[0].error;
    return { groups: groupBySeries(found), failures: remaining };
  }

  async catalogue(source: NovelSource, id: string, signal: AbortSignal) {
    if (!/^\d{1,10}$/.test(id)) throw new DiscoveryError('SOURCE_INVALID');
    return this.fromSource(async () => {
      const snapshot = await this.gateway.readPage(
        source,
        { kind: 'page', path: `/novel/${id}/catalog` },
        signal,
      );
      throwIfCancelled(signal);
      return parseCatalogue(source, snapshot, id);
    });
  }

  async current(source: NovelSource, signal: AbortSignal) {
    const snapshot = await this.fromSource(() =>
      this.gateway.readPage(source, { kind: 'current' }, signal),
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

  private async fetchChapterPage(
    source: NovelSource,
    path: string,
    cache: VolumeFetchCache,
    signal: AbortSignal,
  ): Promise<ParsedChapter> {
    const parsed = await this.fromSource(async () => {
      const snapshot = await this.gateway.readPage(
        source,
        { kind: 'page', path },
        signal,
      );
      throwIfCancelled(signal);
      return parseChapter(source, snapshot, path);
    });
    cache.pages.set(path, parsed);
    return parsed;
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
    const chapterReports: ChapterReport[] = [];
    let pagesFetched = 0;
    const translators = new Set<string>(catalogue.translators);
    const translationMethods: TranslationMethod[] = [
      catalogue.translationMethod,
    ];
    let bytesTotal = 0;
    let missingImages = 0;
    const budget = (bytes: number) => {
      bytesTotal += bytes;
      if (bytesTotal > 64 * 1024 * 1024)
        throw new DiscoveryError('SOURCE_TOO_LARGE');
    };
    const cacheKey = `${source}:${catalogue.id}:${volume.id}`;
    const cache = this.volumeCache(cacheKey);
    const loadImage = async (url: string): Promise<string | null> => {
      throwIfCancelled(signal);
      if (imageCache.has(url)) return imageCache.get(url) ?? null;
      if (imageCache.size >= 250) throw new DiscoveryError('SOURCE_TOO_LARGE');
      imageCache.set(url, null);
      try {
        let bytes = cache.images.get(url);
        if (!bytes) {
          bytes = await this.fromSource(() =>
            this.gateway.readImage(source, url, signal),
          );
          throwIfCancelled(signal);
          if (bytes.byteLength > 10 * 1024 * 1024)
            throw new DiscoveryError('SOURCE_TOO_LARGE');
          cache.images.set(url, bytes);
        }
        budget(bytes.byteLength);
        const format = detectImage(bytes);
        const path = `images/${String(images.length)}.${format.extension}`;
        images.push({ path, mediaType: format.mediaType, bytes });
        imageCache.set(url, path);
        return path;
      } catch (error) {
        throwIfCancelled(signal);
        // A refusal or size violation stops the volume even when missing
        // illustrations were allowed: continuing would keep hitting the source.
        if (
          isSourceRefusal(error) ||
          (error instanceof DiscoveryError && error.code === 'SOURCE_TOO_LARGE')
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
      let chapterImages = 0;
      const visited = new Set<string>();
      while (path) {
        throwIfCancelled(signal);
        if (visited.has(path) || visited.size >= 20)
          throw new DiscoveryError('SOURCE_INCOMPLETE');
        visited.add(path);
        const parsed: ParsedChapter =
          cache.pages.get(path) ??
          (await this.fetchChapterPage(source, path, cache, signal));
        // Catalogue labels can contain the source's substituted characters.
        // Its rendered chapter page supplies the actual readable heading.
        if (visited.size === 1 && parsed.title) resolvedTitle = parsed.title;
        const replacements: (string | null)[] = [];
        chapterImages += parsed.images.length;
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
        translationMethods.push(parsed.translationMethod);
        path = parsed.nextPath ? pagePath(source, parsed.nextPath) : null;
      }
      const html = pages.join('\n');
      chapters.push({ title: resolvedTitle, html });
      pagesFetched += pages.length;
      chapterReports.push({
        title: resolvedTitle,
        pages: pages.length,
        characters: textLength(html),
        images: chapterImages,
      });
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
    // Titles may be neutral; the chapter text then decides the script.
    const script =
      volume.script !== 'unknown'
        ? volume.script
        : detectChineseScript(chapters.map((item) => item.html).join(''));
    const origin = {
      source,
      novelId: catalogue.id,
      volumeId: volume.id,
      url: sourceUrl(source, `/novel/${catalogue.id}/vol_${volume.id}.html`),
      revision,
      translators: [...translators].slice(0, 20),
      script,
      translationMethod: combineTranslationMethods(translationMethods),
      edition: volume.edition,
      volumeKind: volume.kind,
    };
    const bytes = await buildNovelEpub(
      {
        title: volume.title,
        author: catalogue.author,
        identifier: `urn:lightreader:${source}:${catalogue.id}:${volume.id}:${revision}`,
        sourceUrl: origin.url,
        translators: origin.translators,
        script: origin.script,
        translationMethod: origin.translationMethod,
        edition: origin.edition,
        // Catalogue order, so side stories sort where the source lists them.
        series: {
          title: catalogue.title,
          index:
            catalogue.volumes.findIndex((item) => item.id === volume.id) + 1,
        },
        chapters,
        images,
        coverPath,
        missingImages,
      },
      signal,
    );
    throwIfCancelled(signal);
    const report: AcquisitionReport = {
      source,
      novelId: catalogue.id,
      volumeId: volume.id,
      title: volume.title,
      expectedChapters: volume.chapters.length,
      builtChapters: chapters.length,
      pagesFetched,
      images: {
        total: imageCache.size,
        embedded: images.length,
        missing: missingImages,
      },
      epubBytes: bytes.byteLength,
      chapters: chapterReports,
      shortChapters: shortChapters(chapterReports),
      validation: await validateEpub(bytes),
    };
    throwIfCancelled(signal);
    // A structurally broken book would only fail later in the reader.
    if (report.validation.errors.length) throw new EpubValidationError(report);
    onProgress({ stage: 'importing', completed: 0, total: 1 });
    const result = await this.importer.importBytes(
      `${volume.title}.epub`,
      bytes,
      origin,
    );
    // The volume is in the library now; its fetched pages are no longer needed.
    this.fetchCache.delete(cacheKey);
    return { ...result, missingImages, report };
  }
}
