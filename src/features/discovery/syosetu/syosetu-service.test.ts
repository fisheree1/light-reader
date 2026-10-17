import { strFromU8, unzipSync } from 'fflate';

import { WebCryptoContentHasher } from '../../../platform/crypto/content-hasher';
import { FixtureSyosetuGateway } from '../../../test/fixtures/syosetu-gateway';
import { createTestBook } from '../../../test/fixtures/web-records';
import type { BookImporter } from '../../library/services/book-import-service';
import { FflateEpubMetadataParser } from '../../library/services/epub-metadata-parser';
import { DiscoveryError } from '../domain/discovery-error';
import { RATE_LIMIT_COOLDOWN_MS } from '../services/book-discovery-service';
import { SyosetuService } from './syosetu-service';

function setup(now = () => 0) {
  const gateway = new FixtureSyosetuGateway();
  const importBytes = vi
    .fn<NonNullable<BookImporter['importBytes']>>()
    .mockResolvedValue({ status: 'created', book: createTestBook() });
  const service = new SyosetuService(
    gateway,
    { importEpub: vi.fn(), importBytes },
    new WebCryptoContentHasher(),
    { now },
  );
  return { gateway, importBytes, service };
}

describe('SyosetuService', () => {
  const signal = new AbortController().signal;

  it('reads every contents page with progress', async () => {
    const { service } = setup();
    const progress = vi.fn();
    const toc = await service.toc('n0001aa', signal, progress);
    expect(progress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(toc.volumes.map((volume) => volume.id)).toEqual(['1', '4']);
    await expect(service.toc('../x', signal)).rejects.toMatchObject({
      code: 'SOURCE_INVALID',
    });
  });

  it('builds a Japanese EPUB with series, origin and optional vertical text', async () => {
    const { importBytes, service } = setup();
    const toc = await service.toc('n0001aa', signal);
    const { report } = await service.acquire(
      { toc, volume: toc.volumes[0], vertical: true, onProgress: vi.fn() },
      signal,
    );
    expect(report).toMatchObject({
      source: 'syosetu',
      expectedChapters: 3,
      builtChapters: 3,
      validation: { errors: [] },
    });
    const [fileName, bytes, origin] = importBytes.mock.calls[0];
    expect(fileName).toBe('テスト用の長編 第一部 はじまり.epub');
    expect(origin).toMatchObject({
      source: 'syosetu',
      novelId: 'n0001aa',
      volumeId: '1',
      url: 'https://ncode.syosetu.com/n0001aa/',
    });
    const files = unzipSync(bytes);
    const opf = strFromU8(files['EPUB/package.opf']);
    expect(opf).toContain('<dc:language>ja</dc:language>');
    expect(opf).toContain('page-progression-direction="rtl"');
    expect(strFromU8(files['EPUB/style.css'])).toContain('vertical-rl');
    expect(strFromU8(files['EPUB/source.xhtml'])).not.toContain('译者');
    expect(strFromU8(files['EPUB/chapter-1.xhtml'])).toContain(
      '<rt>かんじ</rt>',
    );
    const parsed = await new FflateEpubMetadataParser().parse(bytes, 'x.epub');
    expect(parsed.metadata.series).toEqual({
      title: 'テスト用の長編',
      index: 1,
    });
  });

  it('reuses fetched episodes on retry and pauses after rate limiting', async () => {
    let now = 0;
    const { gateway, service } = setup(() => now);
    const toc = await service.toc('n0001aa', signal);
    const original = gateway.page.bind(gateway);
    const page = vi
      .spyOn(gateway, 'page')
      .mockImplementation((path, requestSignal) =>
        path === '/n0001aa/3/'
          ? Promise.reject(new DiscoveryError('SOURCE_RATE_LIMITED'))
          : original(path, requestSignal),
      );
    const input = {
      toc,
      volume: toc.volumes[0],
      vertical: false,
      onProgress: vi.fn(),
    };
    await expect(service.acquire(input, signal)).rejects.toMatchObject({
      code: 'SOURCE_RATE_LIMITED',
    });
    await expect(service.search('x', 1, signal)).rejects.toMatchObject({
      code: 'SOURCE_COOLING_DOWN',
    });

    now += RATE_LIMIT_COOLDOWN_MS;
    page.mockClear();
    page.mockImplementation(original);
    await service.acquire(input, signal);
    // Episodes 1 and 2 came from the first attempt.
    expect(page.mock.calls.map(([path]) => path)).toEqual(['/n0001aa/3/']);
  });

  it('embeds illustrations, marks missing ones and stops on refusal', async () => {
    const { gateway, importBytes, service } = setup();
    const toc = await service.toc('n0001aa', signal);
    const input = {
      toc,
      volume: toc.volumes[0],
      vertical: false,
      onProgress: vi.fn(),
    };
    const { missingImages, report } = await service.acquire(input, signal);
    expect(missingImages).toBe(1);
    expect(report.images).toEqual({ total: 3, embedded: 2, missing: 1 });
    expect(report.chapters.map((chapter) => chapter.images)).toEqual([1, 1, 1]);
    const files = unzipSync(importBytes.mock.calls[0][1]);
    expect(
      Object.keys(files).filter((name) => name.startsWith('EPUB/images/')),
    ).toEqual(['EPUB/images/0.png', 'EPUB/images/1.png']);
    expect(strFromU8(files['EPUB/chapter-1.xhtml'])).toContain(
      '<img src="images/0.png" alt="挿絵" />',
    );
    expect(strFromU8(files['EPUB/chapter-3.xhtml'])).toContain(
      '［挿絵：取得できませんでした］',
    );

    vi.spyOn(gateway, 'image').mockRejectedValue(
      new DiscoveryError('SOURCE_ACCESS_DENIED'),
    );
    await expect(service.acquire(input, signal)).rejects.toMatchObject({
      code: 'SOURCE_ACCESS_DENIED',
    });
  });

  it('reads a short story with a single request', async () => {
    const { gateway, importBytes, service } = setup();
    const page = vi
      .spyOn(gateway, 'page')
      .mockResolvedValue(
        '<h1 class="p-novel__title">短編</h1><div class="p-novel__body"><div class="js-novel-text p-novel__text"><p>本文です。</p></div></div>',
      );
    const toc = await service.toc('n0002bb', signal);
    await service.acquire(
      { toc, volume: toc.volumes[0], vertical: false, onProgress: vi.fn() },
      signal,
    );
    expect(page).toHaveBeenCalledTimes(1);
    expect(importBytes.mock.calls[0]?.[0]).toBe('短編.epub');
  });
});
