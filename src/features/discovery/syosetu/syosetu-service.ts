import type { ContentHasher } from '../../../platform/crypto/content-hasher';
import type { BookImporter } from '../../library/services/book-import-service';
import {
  EpubValidationError,
  shortChapters,
  textLength,
  type AcquisitionReport,
  type ChapterReport,
} from '../domain/acquisition-report';
import type { AcquisitionProgress } from '../domain/catalog';
import {
  DiscoveryError,
  isSourceRefusal,
  throwIfCancelled,
} from '../domain/discovery-error';
import {
  buildNovelEpub,
  detectImage,
  type EpubImage,
} from '../services/epub-builder-service';
import { validateEpub } from '../services/epub-validator';
import { RATE_LIMIT_COOLDOWN_MS } from '../services/book-discovery-service';
import {
  episodePath,
  MAX_TOC_PAGES,
  ncodePattern,
  workUrl,
  type SyosetuEpisodeContent,
  type SyosetuSearchResult,
  type SyosetuToc,
  type SyosetuVolume,
} from './syosetu';
import {
  groupVolumes,
  parseEpisode,
  parseSearch,
  parseTocPage,
  type TocItem,
} from './syosetu-parser';

export interface SyosetuGateway {
  readonly available: boolean;
  /** API search; the native side spaces every request to the site. */
  search(query: string, page: number, signal: AbortSignal): Promise<string>;
  /** A table-of-contents or episode page, by path. */
  page(path: string, signal: AbortSignal): Promise<string>;
  /** An illustration (みてみん) embedded in an episode. */
  image(url: string, signal: AbortSignal): Promise<Uint8Array>;
}

/** Episodes and illustrations kept for a retry in this session. */
const CACHED_EPISODES = 1000;
const CACHED_IMAGES = 200;
const MAX_VOLUME_IMAGES = 250;
const MISSING_ILLUSTRATION = '<p>［挿絵：取得できませんでした］</p>';

export class SyosetuService {
  readonly gateway: SyosetuGateway;
  private readonly importer: BookImporter;
  private readonly hasher: ContentHasher;
  private readonly now: () => number;
  private coolingDownUntil = 0;
  private readonly episodes = new Map<string, SyosetuEpisodeContent>();
  private readonly images = new Map<string, Uint8Array>();

  constructor(
    gateway: SyosetuGateway,
    importer: BookImporter,
    hasher: ContentHasher,
    options: { now?: () => number } = {},
  ) {
    this.gateway = gateway;
    this.importer = importer;
    this.hasher = hasher;
    this.now = options.now ?? Date.now;
  }

  private async fromSite<T>(action: () => Promise<T>): Promise<T> {
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

  async search(
    query: string,
    page: number,
    signal: AbortSignal,
  ): Promise<SyosetuSearchResult> {
    const text = await this.fromSite(() =>
      this.gateway.search(query.trim(), page, signal),
    );
    throwIfCancelled(signal);
    return parseSearch(text);
  }

  /** Reads every table-of-contents page (up to a limit), one by one. */
  async toc(
    ncode: string,
    signal: AbortSignal,
    onProgress: (completed: number, total: number) => void = () => undefined,
  ): Promise<SyosetuToc> {
    if (!ncodePattern.test(ncode)) throw new DiscoveryError('SOURCE_INVALID');
    const first = parseTocPage(
      await this.fromSite(() => this.gateway.page(`/${ncode}/`, signal)),
      ncode,
    );
    const pages = Math.min(first.lastPage, MAX_TOC_PAGES);
    const items: TocItem[] = [...first.items];
    onProgress(1, pages);
    for (let page = 2; page <= pages; page += 1) {
      throwIfCancelled(signal);
      const next = parseTocPage(
        await this.fromSite(() =>
          this.gateway.page(`/${ncode}/?p=${String(page)}`, signal),
        ),
        ncode,
      );
      items.push(...next.items);
      onProgress(page, pages);
    }
    return {
      ncode,
      title: first.title,
      author: first.author,
      summary: first.summary,
      short: first.short,
      volumes: groupVolumes(items, first.title),
      truncated: first.lastPage > MAX_TOC_PAGES,
    };
  }

  private async episode(
    ncode: string,
    number: number,
    signal: AbortSignal,
  ): Promise<SyosetuEpisodeContent> {
    const path = episodePath(ncode, number);
    const cached = this.episodes.get(path);
    if (cached) return cached;
    const content = parseEpisode(
      await this.fromSite(() => this.gateway.page(path, signal)),
      ncode,
      number,
    );
    this.episodes.set(path, content);
    if (this.episodes.size > CACHED_EPISODES) {
      const oldest = this.episodes.keys().next().value;
      if (oldest !== undefined) this.episodes.delete(oldest);
    }
    return content;
  }

  async acquire(
    input: {
      toc: SyosetuToc;
      volume: SyosetuVolume;
      vertical: boolean;
      onProgress: (progress: AcquisitionProgress) => void;
    },
    signal: AbortSignal,
  ) {
    const { toc, volume, onProgress } = input;
    if (!this.importer.importBytes)
      throw new DiscoveryError('SOURCE_UNAVAILABLE');
    if (!volume.episodes.length) throw new DiscoveryError('SOURCE_INCOMPLETE');
    const chapters: { title: string; html: string }[] = [];
    const images: EpubImage[] = [];
    const imagePaths = new Map<string, string | null>();
    const chapterReports: ChapterReport[] = [];
    let missingImages = 0;
    const loadImage = async (url: string): Promise<string | null> => {
      if (imagePaths.has(url)) return imagePaths.get(url) ?? null;
      if (imagePaths.size >= MAX_VOLUME_IMAGES)
        throw new DiscoveryError('SOURCE_TOO_LARGE');
      imagePaths.set(url, null);
      try {
        let bytes = this.images.get(url);
        if (!bytes) {
          bytes = await this.fromSite(() => this.gateway.image(url, signal));
          throwIfCancelled(signal);
          this.images.set(url, bytes);
          if (this.images.size > CACHED_IMAGES) {
            const oldest = this.images.keys().next().value;
            if (oldest !== undefined) this.images.delete(oldest);
          }
        }
        const format = detectImage(bytes);
        const path = `images/${String(images.length)}.${format.extension}`;
        images.push({ path, mediaType: format.mediaType, bytes });
        imagePaths.set(url, path);
        return path;
      } catch (error) {
        throwIfCancelled(signal);
        // A refusal stops the volume; continuing would keep hitting the site.
        if (
          isSourceRefusal(error) ||
          (error instanceof DiscoveryError && error.code === 'SOURCE_TOO_LARGE')
        )
          throw error;
        missingImages += 1;
        return null;
      }
    };
    for (const [index, episode] of volume.episodes.entries()) {
      throwIfCancelled(signal);
      onProgress({
        stage: 'fetching',
        completed: index,
        total: volume.episodes.length,
      });
      const content = await this.episode(toc.ncode, episode.number, signal);
      const paths: (string | null)[] = [];
      for (const [imageIndex, url] of content.images.entries()) {
        onProgress({
          stage: 'images',
          completed: imageIndex,
          total: content.images.length,
        });
        paths.push(await loadImage(url));
      }
      const html = content.html.replace(
        /<img src="image:(\d+)" alt="([^"]*)" \/>/g,
        (_match, indexText: string, alt: string) => {
          const path = paths[Number(indexText)];
          return path
            ? `<img src="${path}" alt="${alt}" />`
            : MISSING_ILLUSTRATION;
        },
      );
      chapters.push({ title: content.title || episode.title, html });
      chapterReports.push({
        title: content.title || episode.title,
        pages: 1,
        characters: textLength(html),
        images: content.images.length,
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
    const position = toc.volumes.findIndex((item) => item.id === volume.id) + 1;
    const title =
      toc.volumes.length === 1 && volume.title === toc.title
        ? toc.title
        : `${toc.title} ${volume.title}`;
    const origin = {
      source: 'syosetu' as const,
      novelId: toc.ncode,
      volumeId: volume.id,
      url: workUrl(toc.ncode),
      revision,
      translators: [],
    };
    const bytes = await buildNovelEpub(
      {
        title,
        author: toc.author,
        identifier: `urn:lightreader:syosetu:${toc.ncode}:${volume.id}:${revision}`,
        sourceUrl: origin.url,
        translators: [],
        language: 'ja',
        vertical: input.vertical,
        series: { title: toc.title, index: position },
        chapters,
        images,
        coverPath: null,
        missingImages,
      },
      signal,
    );
    throwIfCancelled(signal);
    const report: AcquisitionReport = {
      source: 'syosetu',
      novelId: toc.ncode,
      volumeId: volume.id,
      title,
      expectedChapters: volume.episodes.length,
      builtChapters: chapters.length,
      pagesFetched: chapters.length,
      images: {
        total: imagePaths.size,
        embedded: images.length,
        missing: missingImages,
      },
      epubBytes: bytes.byteLength,
      chapters: chapterReports,
      shortChapters: shortChapters(chapterReports),
      validation: await validateEpub(bytes),
    };
    throwIfCancelled(signal);
    if (report.validation.errors.length) throw new EpubValidationError(report);
    onProgress({ stage: 'importing', completed: 0, total: 1 });
    const result = await this.importer.importBytes(
      `${title}.epub`,
      bytes,
      origin,
    );
    for (const episode of volume.episodes)
      this.episodes.delete(episodePath(toc.ncode, episode.number));
    for (const url of imagePaths.keys()) this.images.delete(url);
    return { ...result, missingImages, report };
  }
}
