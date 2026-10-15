import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { createTestBook } from '../../test/fixtures/web-records';
import { DiscoveryPage } from './discovery-page';
import type { NovelCatalogue } from './domain/catalog';
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
  })),
};

function renderPage(acquire: BookDiscoveryService['acquire']) {
  const services = {
    gateway: { available: true },
    search: vi
      .fn()
      .mockResolvedValue([
        { id: '1', title: '测试轻小说', url: catalogue.url },
      ]),
    catalogue: vi.fn().mockResolvedValue(catalogue),
    current: vi.fn(),
    acquire,
  } as unknown as BookDiscoveryService;
  render(
    <MemoryRouter>
      <DiscoveryPage services={services} />
    </MemoryRouter>,
  );
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
      });
    renderPage(acquire);

    await selectAllVolumesAndAcquire();

    const outcomes = await screen.findByRole('list', { name: '获取结果' });
    await within(outcomes).findByText(/第三卷/);
    expect(acquire).toHaveBeenCalledTimes(3);
  });
});
