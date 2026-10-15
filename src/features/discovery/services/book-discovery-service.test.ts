import { strFromU8, unzipSync } from 'fflate';
import { FixtureNovelGateway } from '../../../test/fixtures/novel-gateway';
import { WebCryptoContentHasher } from '../../../platform/crypto/content-hasher';
import { createTestBook } from '../../../test/fixtures/web-records';
import { FflateEpubMetadataParser } from '../../library/services/epub-metadata-parser';
import type { BookImporter } from '../../library/services/book-import-service';
import { DiscoveryError } from '../domain/discovery-error';
import { EpubValidationError } from '../domain/acquisition-report';
import * as validator from './epub-validator';
import {
  BookDiscoveryService,
  groupBySeries,
  RATE_LIMIT_COOLDOWN_MS,
} from './book-discovery-service';

vi.mock('./epub-validator', async (original) => {
  const actual = await original<typeof import('./epub-validator')>();
  return { ...actual, validateEpub: vi.fn(actual.validateEpub) };
});

function setup() {
  const gateway = new FixtureNovelGateway();
  const importBytes = vi
    .fn<NonNullable<BookImporter['importBytes']>>()
    .mockResolvedValue({ status: 'created', book: createTestBook() });
  const service = new BookDiscoveryService(
    gateway,
    { importEpub: vi.fn(), importBytes },
    new WebCryptoContentHasher(),
  );
  return { gateway, importBytes, service };
}

describe('novel acquisition', () => {
  it('reads a work opened in the source window without submitting another search', async () => {
    const { service, gateway } = setup();
    const read = vi.spyOn(gateway, 'readPage');
    await expect(
      service.current('bilinovel', new AbortController().signal),
    ).resolves.toMatchObject([{ id: '1', title: '测试轻小说' }]);
    expect(read).toHaveBeenCalledWith(
      'bilinovel',
      { kind: 'current' },
      expect.any(AbortSignal),
    );
    read.mockResolvedValueOnce({
      url: 'https://www.linovelib.com/S6/',
      html: '<h1>搜索结果</h1><a href="/novel/1.html">测试轻小说</a>',
    });
    await expect(
      service.current('linovelib', new AbortController().signal),
    ).resolves.toMatchObject([{ id: '1', title: '测试轻小说' }]);
  });
  it('assembles paginated chapters, illustrations and provenance into a stable EPUB', async () => {
    const { service, importBytes } = setup();
    const signal = new AbortController().signal;
    const catalogue = await service.catalogue('bilinovel', '1', signal);
    catalogue.volumes[0].chapters[0].title = '目录中的替代字符N';
    const onProgress = vi.fn();
    const input = {
      source: 'bilinovel' as const,
      catalogue,
      volume: catalogue.volumes[0],
      allowMissingImages: false,
      onProgress,
    };
    await service.acquire(input, signal);
    await service.acquire(input, signal);
    const bytes = importBytes.mock.calls[0][1];
    expect(bytes).toEqual(importBytes.mock.calls[1][1]);
    expect(
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(
        8,
        true,
      ),
    ).toBe(0);
    const files = unzipSync(bytes);
    const chapter = strFromU8(files['EPUB/chapter-1.xhtml']);
    expect(chapter).toContain('同一章节的第二页');
    expect(chapter).toContain('<h1>序章</h1>');
    expect(strFromU8(files['EPUB/nav.xhtml'])).not.toContain('替代字符N');
    expect(chapter).not.toContain('隐藏');
    expect(strFromU8(files['EPUB/chapter-2.xhtml'])).toContain('src="images/');
    expect(importBytes.mock.calls[0][2]).toMatchObject({
      source: 'bilinovel',
      novelId: '1',
      volumeId: '10',
      translators: ['测试译者'],
    });
    expect(
      (await new FflateEpubMetadataParser().parse(bytes, 'fallback.epub'))
        .metadata.title,
    ).toBe('测试轻小说 第一卷');
    expect(onProgress).toHaveBeenLastCalledWith({
      stage: 'importing',
      completed: 0,
      total: 1,
    });
  });
  it('requires explicit missing-image consent and never imports restricted volumes', async () => {
    const { gateway, service, importBytes } = setup();
    vi.spyOn(gateway, 'readImage').mockRejectedValue(new Error('image failed'));
    const signal = new AbortController().signal;
    const catalogue = await service.catalogue('bilinovel', '1', signal);
    const input = {
      source: 'bilinovel' as const,
      catalogue,
      volume: catalogue.volumes[0],
      allowMissingImages: false,
      onProgress: vi.fn(),
    };
    await expect(service.acquire(input, signal)).rejects.toMatchObject({
      code: 'SOURCE_IMAGE_FAILED',
    });
    expect(importBytes).not.toHaveBeenCalled();
    expect(
      (await service.acquire({ ...input, allowMissingImages: true }, signal))
        .missingImages,
    ).toBe(2);
    await expect(
      service.acquire({ ...input, volume: catalogue.volumes[1] }, signal),
    ).rejects.toMatchObject({ code: 'SOURCE_INCOMPLETE' });
  });
  it('does not import after cancellation or a broken pagination chain', async () => {
    const { gateway, service, importBytes } = setup();
    const controller = new AbortController();
    const catalogue = await service.catalogue(
      'bilinovel',
      '1',
      controller.signal,
    );
    const input = {
      source: 'bilinovel' as const,
      catalogue,
      volume: catalogue.volumes[0],
      allowMissingImages: false,
      onProgress: vi.fn(),
    };
    controller.abort();
    await expect(
      service.acquire(input, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(importBytes).not.toHaveBeenCalled();
    const read = gateway.readPage.bind(gateway);
    vi.spyOn(gateway, 'readPage').mockImplementation(
      async (source, request, signal) => {
        const snapshot = await read(source, request, signal);
        return {
          ...snapshot,
          html: snapshot.html.replace('101_2.html', '101_4.html'),
        };
      },
    );
    await expect(
      service.acquire(input, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'SOURCE_INCOMPLETE' });
    expect(importBytes).not.toHaveBeenCalled();
  });

  it('reuses fetched pages and images on retry and clears them after import', async () => {
    const { gateway, importBytes, service } = setup();
    const signal = new AbortController().signal;
    const catalogue = await service.catalogue('bilinovel', '1', signal);
    const input = {
      source: 'bilinovel' as const,
      catalogue,
      volume: catalogue.volumes[0],
      allowMissingImages: false,
      onProgress: vi.fn(),
    };
    const readPage = gateway.readPage.bind(gateway);
    const pages = vi.spyOn(gateway, 'readPage');
    const images = vi.spyOn(gateway, 'readImage');
    // The last chapter page fails once, after earlier pages were fetched.
    pages.mockImplementation((source, request, requestSignal) =>
      request.kind === 'page' &&
      request.path === '/novel/1/102.html' &&
      pages.mock.calls.filter(
        ([, call]) => call.kind === 'page' && call.path === '/novel/1/102.html',
      ).length === 1
        ? Promise.reject(new DiscoveryError('SOURCE_TIMEOUT'))
        : readPage(source, request, requestSignal),
    );
    await expect(service.acquire(input, signal)).rejects.toMatchObject({
      code: 'SOURCE_TIMEOUT',
    });
    expect(pages).toHaveBeenCalledTimes(3);
    expect(images).toHaveBeenCalledTimes(1);

    await service.acquire(input, signal);
    // Only the failed page and the illustration it holds are fetched again.
    expect(pages).toHaveBeenCalledTimes(4);
    expect(images).toHaveBeenCalledTimes(2);
    expect(importBytes).toHaveBeenCalledTimes(1);

    await service.acquire(input, signal);
    expect(pages).toHaveBeenCalledTimes(7);
    expect(images).toHaveBeenCalledTimes(4);
    expect(importBytes.mock.calls[1][1]).toEqual(importBytes.mock.calls[0][1]);
  });

  it('stops on a refused image even when missing images are allowed', async () => {
    const { gateway, importBytes, service } = setup();
    const signal = new AbortController().signal;
    const catalogue = await service.catalogue('bilinovel', '1', signal);
    const images = vi
      .spyOn(gateway, 'readImage')
      .mockRejectedValue(new DiscoveryError('SOURCE_ACCESS_DENIED'));
    await expect(
      service.acquire(
        {
          source: 'bilinovel',
          catalogue,
          volume: catalogue.volumes[0],
          allowMissingImages: true,
          onProgress: vi.fn(),
        },
        signal,
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_ACCESS_DENIED' });
    expect(images).toHaveBeenCalledTimes(1);
    expect(importBytes).not.toHaveBeenCalled();
  });

  it('pauses every request after rate limiting and never retries by itself', async () => {
    let now = 1_000;
    const gateway = new FixtureNovelGateway();
    const service = new BookDiscoveryService(
      gateway,
      { importEpub: vi.fn(), importBytes: vi.fn() },
      new WebCryptoContentHasher(),
      { now: () => now },
    );
    const signal = new AbortController().signal;
    const pages = vi
      .spyOn(gateway, 'readPage')
      .mockRejectedValueOnce(new DiscoveryError('SOURCE_RATE_LIMITED'));

    await expect(
      service.search('bilinovel', '测试', signal),
    ).rejects.toMatchObject({ code: 'SOURCE_RATE_LIMITED' });
    expect(pages).toHaveBeenCalledTimes(1);

    now += RATE_LIMIT_COOLDOWN_MS - 1;
    await expect(
      service.catalogue('bilinovel', '1', signal),
    ).rejects.toMatchObject({ code: 'SOURCE_COOLING_DOWN' });
    expect(pages).toHaveBeenCalledTimes(1);

    now += 1;
    await expect(
      service.search('bilinovel', '测试', signal),
    ).resolves.toHaveLength(1);
    expect(pages).toHaveBeenCalledTimes(2);
  });

  it('treats a throttling notice page as rate limiting', async () => {
    const { gateway, service } = setup();
    vi.spyOn(gateway, 'readPage').mockResolvedValueOnce({
      url: 'https://www.bilinovel.com/search.html',
      html: '<html><head><title>429 Too Many Requests</title></head><body>请稍后再试</body></html>',
    });
    await expect(
      service.search('bilinovel', '测试', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'SOURCE_RATE_LIMITED' });
    await expect(
      service.search('bilinovel', '测试', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'SOURCE_COOLING_DOWN' });
  });

  it('records translators, script, method and edition in the origin and EPUB', async () => {
    const { importBytes, service } = setup();
    const signal = new AbortController().signal;
    const catalogue = await service.catalogue('bilinovel', '1', signal);
    await service.acquire(
      {
        source: 'bilinovel',
        catalogue,
        volume: catalogue.volumes[0],
        allowMissingImages: false,
        onProgress: vi.fn(),
      },
      signal,
    );
    const [, bytes, origin] = importBytes.mock.calls[0];
    expect(origin).toMatchObject({
      translators: ['测试译者'],
      script: 'hans',
      translationMethod: 'unknown',
      edition: null,
      volumeKind: 'main',
    });
    const files = unzipSync(bytes);
    const opf = strFromU8(files['EPUB/package.opf']);
    expect(opf).toContain('<dc:language>zh-Hans</dc:language>');
    expect(opf).toContain(
      '<dc:contributor id="trl0">测试译者</dc:contributor><meta refines="#trl0" property="role" scheme="marc:relators">trl</meta>',
    );
    expect(opf).not.toContain('<dc:description>');
    const sourcePage = strFromU8(files['EPUB/source.xhtml']);
    expect(sourcePage).toContain('<p>译者：测试译者</p>');
    expect(sourcePage).toContain('<p>翻译类型：未知（来源未声明）</p>');
  });

  it('reports what was fetched and refuses to import a structurally broken EPUB', async () => {
    const { service, importBytes } = setup();
    const signal = new AbortController().signal;
    const catalogue = await service.catalogue('bilinovel', '1', signal);
    const input = {
      source: 'bilinovel' as const,
      catalogue,
      volume: catalogue.volumes[0],
      allowMissingImages: false,
      onProgress: vi.fn(),
    };
    const { report } = await service.acquire(input, signal);
    expect(report).toMatchObject({
      source: 'bilinovel',
      novelId: '1',
      volumeId: '10',
      expectedChapters: 2,
      builtChapters: 2,
      pagesFetched: 3,
      images: { total: 2, embedded: 2, missing: 0 },
      validation: { errors: [], warnings: [] },
      // The fixture prologue is a few dozen characters: flagged for review.
      shortChapters: ['序章'],
    });
    expect(report.chapters.map(({ pages, images }) => [pages, images])).toEqual(
      [
        [2, 0],
        [1, 1],
      ],
    );
    expect(report.chapters[0].characters).toBeGreaterThan(20);
    expect(report.epubBytes).toBe(importBytes.mock.calls[0][1].byteLength);

    vi.mocked(validator.validateEpub).mockResolvedValueOnce({
      errors: [{ code: 'xhtml-invalid', path: 'EPUB/chapter-1.xhtml' }],
      warnings: [],
    });
    const rejected = await service
      .acquire(input, signal)
      .catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(EpubValidationError);
    expect(rejected).toMatchObject({
      code: 'SOURCE_BUILD_INVALID',
      report: { validation: { errors: [{ code: 'xhtml-invalid' }] } },
    });
    expect(importBytes).toHaveBeenCalledTimes(1);
  });

  describe('multi-source search', () => {
    it('tries the other script only when the typed spelling finds nothing', async () => {
      const { gateway, service } = setup();
      const signal = new AbortController().signal;
      const read = gateway.readPage.bind(gateway);
      const pages = vi
        .spyOn(gateway, 'readPage')
        .mockImplementation((source, request, requestSignal) =>
          request.kind === 'search' && request.query === '测试轻小说'
            ? Promise.resolve({
                url: 'https://www.bilinovel.com/search.html',
                html: '<p>没有符合条件的结果</p>',
              })
            : read(source, request, requestSignal),
        );

      const fallback = await service.searchSources(
        ['bilinovel'],
        '测试轻小说',
        signal,
      );
      expect(pages.mock.calls.map(([, request]) => request)).toEqual([
        { kind: 'search', query: '测试轻小说' },
        { kind: 'search', query: '測試輕小說' },
      ]);
      expect(fallback.groups).toHaveLength(1);

      pages.mockClear();
      await service.searchSources(['bilinovel'], '輕小說', signal);
      expect(pages).toHaveBeenCalledTimes(1);
    });

    it('groups same-titled works across sources without merging them', async () => {
      const { service } = setup();
      const result = await service.searchSources(
        ['bilinovel', 'linovelib'],
        '测试',
        new AbortController().signal,
      );
      expect(result.failures).toEqual([]);
      expect(result.groups).toEqual([
        {
          key: expect.any(String) as string,
          title: '测试轻小说',
          entries: [
            expect.objectContaining({ source: 'bilinovel', id: '1' }),
            expect.objectContaining({ source: 'linovelib', id: '1' }),
          ],
        },
      ]);
      expect(
        groupBySeries([
          { source: 'bilinovel', id: '1', title: '《敗北女角》', url: 'a' },
          { source: 'linovelib', id: '9', title: '败北女角', url: 'b' },
          { source: 'linovelib', id: '9', title: '败北女角', url: 'b' },
          { source: 'linovelib', id: '3', title: '败北女角 外传', url: 'c' },
        ]).map((group) => group.entries.length),
      ).toEqual([2, 1]);
    });

    it("keeps one source's results when another fails, and fails when all do", async () => {
      const { gateway, service } = setup();
      const signal = new AbortController().signal;
      const read = gateway.readPage.bind(gateway);
      vi.spyOn(gateway, 'readPage').mockImplementation(
        (source, request, requestSignal) =>
          source === 'linovelib'
            ? Promise.reject(new DiscoveryError('SOURCE_ACCESS_DENIED'))
            : read(source, request, requestSignal),
      );

      const partial = await service.searchSources(
        ['bilinovel', 'linovelib'],
        '测试',
        signal,
      );
      expect(partial.groups[0]?.entries).toEqual([
        expect.objectContaining({ source: 'bilinovel' }),
      ]);
      expect(partial.failures).toEqual([
        {
          source: 'linovelib',
          error: expect.objectContaining({
            code: 'SOURCE_ACCESS_DENIED',
          }) as unknown,
        },
      ]);
      await expect(
        service.searchSources(['linovelib'], '测试', signal),
      ).rejects.toMatchObject({ code: 'SOURCE_ACCESS_DENIED' });
    });
  });
});
