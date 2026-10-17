import { render, screen, waitFor, within } from '@testing-library/react';
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
import { resetDownloads } from './downloads/download-queue';
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
  const view = render(
    <MemoryRouter>
      <DiscoveryPage services={services} />
    </MemoryRouter>,
  );
  return { loadCatalogue, unmount: view.unmount };
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

beforeEach(() => {
  resetDownloads();
});

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
    // The queued third volume is cancelled with the reason, never started.
    expect(
      within(
        within(outcomes).getByText('第三卷').closest('li') as HTMLElement,
      ).getByText('书源拒绝或限制了访问，剩余卷册已停止获取。'),
    ).toBeVisible();
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
    await waitFor(() => {
      expect(acquire).toHaveBeenCalledTimes(3);
    });
    const third = within(outcomes).getByText('第三卷').closest('li');
    expect(
      await within(third as HTMLElement).findByText('已加入书架'),
    ).toBeVisible();
  });

  it('keeps downloading after the page is left and shows progress on return', async () => {
    let finish: () => void = () => undefined;
    const acquire = vi.fn<BookDiscoveryService['acquire']>(
      (input) =>
        new Promise((resolve) => {
          input.onProgress({ stage: 'fetching', completed: 1, total: 2 });
          finish = () => {
            resolve({
              status: 'created',
              book: createTestBook(),
              missingImages: 0,
              report,
            });
          };
        }),
    );
    const { unmount } = renderPage(acquire);
    await selectAllVolumesAndAcquire();
    expect(await screen.findByText('获取章节 · 1/2')).toBeVisible();
    unmount();
    // Leaving the page does not cancel: the first volume completes.
    finish();
    renderPage(acquire);
    const outcomes = await screen.findByRole('list', { name: '获取结果' });
    expect(
      await within(
        within(outcomes).getByText('第一卷').closest('li') as HTMLElement,
      ).findByText('已加入书架'),
    ).toBeVisible();
    // The other two queued volumes run after it.
    await waitFor(() => {
      expect(acquire).toHaveBeenCalledTimes(2);
    });
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
    // A failed structure check opens its details; passing ones stay folded.
    expect(within(outcomes).getByText('结构校验发现 1 个错误')).toBeVisible();
    expect(within(outcomes).getByText(/未通过结构校验/)).toBeVisible();
    const short = within(outcomes).getAllByText('疑似过短章节：第一章')[0];
    expect(short).not.toBeVisible();

    // user-event installs its own clipboard; spy on the one it installed.
    const user = userEvent.setup();
    await user.click(within(outcomes).getAllByText('验收详情')[0]);
    expect(short).toBeVisible();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(
      within(outcomes).getAllByRole('button', { name: '复制验收报告' })[1],
    );
    expect(JSON.parse(writeText.mock.calls[0][0])).toEqual(invalid);
    expect(await within(outcomes).findByText('已复制')).toBeVisible();
  });
});

describe('DiscoveryPage followed series', () => {
  const ownedBook = (id: string, volumeId: string, createdAt: number) => ({
    ...createTestBook({ id, title: `测试轻小说 第一卷`, createdAt }),
    favorite: false,
    tags: [],
    lastReadAt: null,
    progress: null,
    metadata: {
      ...createTestBook().metadata,
      series: { title: '测试轻小说', index: 1 },
      origin: {
        source: 'bilinovel' as const,
        novelId: '1',
        volumeId,
        url: 'https://www.bilinovel.com/novel/1/vol_10.html',
        revision: 'a'.repeat(64),
        translators: [],
      },
    },
  });

  function renderFollowed(initialEntry = '/discover') {
    const loadCatalogue = vi.fn().mockResolvedValue(catalogue);
    const services = {
      gateway: { available: true },
      searchSources: vi.fn().mockResolvedValue({
        groups: [{ key: 'k', title: entry.title, entries: [entry] }],
        failures: [],
      }),
      catalogue: loadCatalogue,
      current: vi.fn(),
      acquire: vi.fn(),
    } as unknown as BookDiscoveryService;
    const list = vi
      .fn()
      .mockResolvedValue([
        ownedBook('old', '10', 1),
        ownedBook('new', '10', 5),
      ]);
    render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <DiscoveryPage library={{ list }} services={services} />
      </MemoryRouter>,
    );
    return { loadCatalogue };
  }

  it('lists fetched works and marks owned volumes when checking for new ones', async () => {
    const user = userEvent.setup();
    const { loadCatalogue } = renderFollowed();

    const followed = await screen.findByRole('region', { name: '我的系列' });
    expect(within(followed).getByText('Bilinovel · 书架中 1 卷')).toBeVisible();
    await user.click(
      within(followed).getByRole('button', { name: '检查新卷' }),
    );
    expect(loadCatalogue).toHaveBeenCalledWith(
      'bilinovel',
      '1',
      expect.any(AbortSignal),
    );

    const volumes = await screen.findByRole('region', { name: '卷册选择' });
    expect(
      within(volumes).getByText('书架中已有 1 卷，可获取的新卷 2 卷。'),
    ).toBeVisible();
    // Owned volumes stay selectable, to fetch a revised copy on purpose.
    expect(
      within(volumes).getByRole('checkbox', { name: /第一卷/ }),
    ).toBeEnabled();
    expect(within(volumes).getByText('书架中已有')).toBeVisible();
    await user.click(
      within(volumes).getByRole('button', { name: '选择全部未收藏的卷（2）' }),
    );
    expect(
      within(volumes).getByRole('checkbox', { name: /第二卷/ }),
    ).toBeChecked();
    expect(
      within(volumes).getByRole('checkbox', { name: /第一卷/ }),
    ).not.toBeChecked();
    expect(screen.getByRole('button', { name: '获取所选 2 卷' })).toBeEnabled();
  });

  it('says in search results which works already have volumes on the shelf', async () => {
    const user = userEvent.setup();
    renderFollowed();
    await screen.findByRole('region', { name: '我的系列' });
    await user.type(screen.getByPlaceholderText('输入作品名或作者'), '测试');
    await user.click(screen.getByRole('button', { name: '搜索书源' }));
    const results = await screen.findByRole('region', { name: '搜索结果' });
    expect(within(results).getByText('书架中已有 1 卷')).toBeVisible();
  });

  it('opens a work straight from a shelf link', async () => {
    const { loadCatalogue } = renderFollowed(
      '/discover?source=linovelib&novel=1',
    );
    await screen.findByRole('region', { name: '卷册选择' });
    expect(loadCatalogue).toHaveBeenCalledWith(
      'linovelib',
      '1',
      expect.any(AbortSignal),
    );
  });

  it('ignores malformed links', async () => {
    const { loadCatalogue } = renderFollowed(
      '/discover?source=evil&novel=../1',
    );
    await screen.findByRole('region', { name: '我的系列' });
    expect(loadCatalogue).not.toHaveBeenCalled();
  });
});
