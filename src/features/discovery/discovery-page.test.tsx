import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { createTestBook } from '../../test/fixtures/web-records';
import { DiscoveryPage } from './discovery-page';
import type { NovelCatalogue } from './domain/catalog';
import {
  EpubValidationError,
  type AcquisitionReport,
} from './domain/acquisition-report';
import { DiscoveryError } from './domain/discovery-error';
import type { BookDiscoveryService } from './services/book-discovery-service';

const chapter = { id: '1', title: '第一章', path: '/novel/1/1.html' };
const catalogue: NovelCatalogue = {
  id: '1',
  title: '测试轻小说',
  author: '作者',
  url: 'https://www.bilinovel.com/novel/1.html',
  volumes: ['第一卷', '第二卷', '第三卷'].map((title, index) => ({
    id: String(index + 10),
    title,
    chapters: [chapter],
    unavailableChapters: 0,
    coverUrl: null,
    contentKind: 'novel' as const,
    kind: 'main' as const,
    edition: null,
    script: 'hans' as const,
  })),
  translators: [],
  translationMethod: 'unknown',
};

const report: AcquisitionReport = {
  source: 'bilinovel',
  novelId: '1',
  volumeId: '10',
  title: '第一卷',
  expectedChapters: 1,
  builtChapters: 1,
  pagesFetched: 2,
  images: { total: 1, embedded: 1, missing: 0 },
  epubBytes: 1000,
  chapters: [{ title: '第一章', pages: 2, characters: 10, images: 0 }],
  shortChapters: ['第一章'],
  validation: { errors: [], warnings: [] },
};

const entry = {
  source: 'bilinovel' as const,
  id: '1',
  title: '测试轻小说',
  url: catalogue.url,
};

function renderPage(
  acquire: BookDiscoveryService['acquire'],
  searchSources: BookDiscoveryService['searchSources'] = vi
    .fn<BookDiscoveryService['searchSources']>()
    .mockResolvedValue({
      groups: [{ key: 'k', title: entry.title, entries: [entry] }],
      failures: [],
    }),
) {
  const loadCatalogue = vi.fn().mockResolvedValue(catalogue);
  const services = {
    gateway: { available: true },
    searchSources,
    catalogue: loadCatalogue,
    current: vi.fn(),
    acquire,
  } as unknown as BookDiscoveryService;
  render(
    <MemoryRouter>
      <DiscoveryPage services={services} />
    </MemoryRouter>,
  );
  return { loadCatalogue };
}

async function selectAllVolumesAndAcquire() {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText('输入作品名或作者'), '测试');
  await user.click(screen.getByRole('button', { name: '搜索书源' }));
  await user.click(await screen.findByRole('button', { name: /查看卷册/ }));
  const volumes = await screen.findByRole('region', { name: '卷册选择' });
  for (const title of ['第一卷', '第二卷', '第三卷'])
    await user.click(
      within(volumes).getByRole('checkbox', { name: new RegExp(title) }),
    );
  await user.click(screen.getByRole('button', { name: '获取所选 3 卷' }));
}

describe('DiscoveryPage acquisition', () => {
  it('stops the remaining volumes when the source refuses a request', async () => {
    const acquire = vi
      .fn<BookDiscoveryService['acquire']>()
      .mockResolvedValueOnce({
        status: 'created',
        book: createTestBook(),
        missingImages: 0,
        report,
      })
      .mockRejectedValueOnce(new DiscoveryError('SOURCE_RATE_LIMITED'));
    renderPage(acquire);

    await selectAllVolumesAndAcquire();

    expect(
      await screen.findByText('书源拒绝或限制了访问，剩余卷册已停止获取。'),
    ).toBeVisible();
    expect(acquire).toHaveBeenCalledTimes(2);
    const outcomes = screen.getByRole('list', { name: '获取结果' });
    expect(within(outcomes).getByText(/第一卷/)).toBeVisible();
    expect(within(outcomes).getByText(/书源提示请求过于频繁/)).toBeVisible();
    expect(within(outcomes).queryByText(/第三卷/)).not.toBeInTheDocument();
  });

  it('continues with the next volume after an ordinary failure', async () => {
    const acquire = vi
      .fn<BookDiscoveryService['acquire']>()
      .mockRejectedValueOnce(new DiscoveryError('SOURCE_INCOMPLETE'))
      .mockResolvedValue({
        status: 'created',
        book: createTestBook(),
        missingImages: 0,
        report,
      });
    renderPage(acquire);

    await selectAllVolumesAndAcquire();

    const outcomes = await screen.findByRole('list', { name: '获取结果' });
    await within(outcomes).findByText(/第三卷/);
    expect(acquire).toHaveBeenCalledTimes(3);
  });
});

describe('DiscoveryPage multi-source search', () => {
  it('lists same-titled works per source and retries only a failed source', async () => {
    const linovelib = { ...entry, source: 'linovelib' as const, id: '7' };
    const searchSources = vi
      .fn<BookDiscoveryService['searchSources']>()
      .mockResolvedValueOnce({
        groups: [{ key: 'k', title: entry.title, entries: [entry] }],
        failures: [
          {
            source: 'linovelib',
            error: new DiscoveryError('SOURCE_ACCESS_DENIED'),
          },
        ],
      })
      .mockResolvedValueOnce({
        groups: [{ key: 'k', title: entry.title, entries: [linovelib] }],
        failures: [],
      });
    const { loadCatalogue } = renderPage(vi.fn(), searchSources);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText('书源'), 'all');
    await user.type(screen.getByPlaceholderText('输入作品名或作者'), '测试');
    await user.click(screen.getByRole('button', { name: '搜索书源' }));
    expect(searchSources).toHaveBeenLastCalledWith(
      ['bilinovel', 'linovelib'],
      '测试',
      expect.any(AbortSignal),
    );
    expect(await screen.findByText(/Linovelib 搜索失败/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: '重试 Linovelib' }));
    expect(searchSources).toHaveBeenLastCalledWith(
      ['linovelib'],
      '测试',
      expect.any(AbortSignal),
    );
    expect(await screen.findByText(/未合并/)).toBeVisible();
    expect(screen.queryByText(/搜索失败/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Linovelib/ }));
    await screen.findByRole('region', { name: '卷册选择' });
    expect(loadCatalogue).toHaveBeenCalledWith(
      'linovelib',
      '7',
      expect.any(AbortSignal),
    );
  });
});

describe('DiscoveryPage acceptance report', () => {
  it('summarizes each acquisition and keeps the report of a rejected build', async () => {
    const invalid = {
      ...report,
      volumeId: '11',
      validation: {
        errors: [{ code: 'image-missing', path: 'EPUB/chapter-1.xhtml' }],
        warnings: [],
      },
    };
    const acquire = vi
      .fn<BookDiscoveryService['acquire']>()
      .mockResolvedValueOnce({
        status: 'created',
        book: createTestBook(),
        missingImages: 0,
        report,
      })
      .mockRejectedValueOnce(new EpubValidationError(invalid))
      .mockResolvedValue({
        status: 'created',
        book: createTestBook(),
        missingImages: 0,
        report,
      });
    renderPage(acquire);

    await selectAllVolumesAndAcquire();

    const outcomes = await screen.findByRole('list', { name: '获取结果' });
    await within(outcomes).findByText(/第三卷/);
    expect(
      within(outcomes).getAllByText(/验收：1\/1 章 · 2 页 · 图片 1\/1/),
    ).toHaveLength(3);
    expect(within(outcomes).getByText('结构校验发现 1 个错误')).toBeVisible();
    expect(within(outcomes).getByText(/未通过结构校验/)).toBeVisible();
    expect(
      within(outcomes).getAllByText('疑似过短章节：第一章')[0],
    ).toBeVisible();

    // user-event installs its own clipboard; spy on the one it installed.
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(
      within(outcomes).getAllByRole('button', { name: '复制验收报告' })[1],
    );
    expect(JSON.parse(writeText.mock.calls[0][0])).toEqual(invalid);
    expect(await within(outcomes).findByText('已复制')).toBeVisible();
  });
});
