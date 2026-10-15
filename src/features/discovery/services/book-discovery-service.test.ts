import { strFromU8, unzipSync } from 'fflate';
import { FixtureNovelGateway } from '../../../test/fixtures/novel-gateway';
import { WebCryptoContentHasher } from '../../../platform/crypto/content-hasher';
import { createTestBook } from '../../../test/fixtures/web-records';
import { FflateEpubMetadataParser } from '../../library/services/epub-metadata-parser';
import type { BookImporter } from '../../library/services/book-import-service';
import { DiscoveryError } from '../domain/discovery-error';
import {
  BookDiscoveryService,
  RATE_LIMIT_COOLDOWN_MS,
} from './book-discovery-service';

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
});
