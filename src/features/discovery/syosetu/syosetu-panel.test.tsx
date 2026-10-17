import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { WebCryptoContentHasher } from '../../../platform/crypto/content-hasher';
import { FixtureSyosetuGateway } from '../../../test/fixtures/syosetu-gateway';
import { createTestBook } from '../../../test/fixtures/web-records';
import type { BookImporter } from '../../library/services/book-import-service';
import { resetDownloads } from '../downloads/download-queue';
import { SyosetuPanel } from './syosetu-panel';
import { SyosetuService } from './syosetu-service';

function owned() {
  const book = createTestBook({ id: 'owned', title: 'テスト用の長編 第二部' });
  return {
    ...book,
    favorite: false,
    tags: [],
    lastReadAt: null,
    progress: null,
    metadata: {
      ...book.metadata,
      origin: {
        source: 'syosetu' as const,
        novelId: 'n0001aa',
        volumeId: '4',
        url: 'https://ncode.syosetu.com/n0001aa/',
        revision: 'd'.repeat(64),
        translators: [],
      },
    },
  };
}

describe('SyosetuPanel', () => {
  beforeEach(() => {
    resetDownloads();
  });

  it('searches, marks owned parts and saves new ones', async () => {
    const user = userEvent.setup();
    const importBytes = vi
      .fn<NonNullable<BookImporter['importBytes']>>()
      .mockResolvedValue({ status: 'created', book: createTestBook() });
    render(
      <MemoryRouter>
        <SyosetuPanel
          library={{ list: vi.fn().mockResolvedValue([owned()]) }}
          services={
            new SyosetuService(
              new FixtureSyosetuGateway(),
              { importEpub: vi.fn(), importBytes },
              new WebCryptoContentHasher(),
            )
          }
        />
      </MemoryRouter>,
    );

    const followed = await screen.findByRole('region', { name: '我的系列' });
    expect(within(followed).getByText('书架中 1 部分')).toBeVisible();

    await user.type(screen.getByRole('searchbox'), '本好き');
    await user.click(screen.getByRole('button', { name: '搜索なろう' }));
    const results = await screen.findByRole('region', { name: '搜索结果' });
    expect(within(results).getByText(/连载中 · 4 话/)).toBeVisible();
    await user.click(within(results).getByRole('button', { name: '查看目录' }));

    const toc = await screen.findByRole('region', { name: '目录' });
    expect(
      within(toc).getByText('书架中已有 1 卷，可获取的新卷 1 卷。'),
    ).toBeVisible();
    expect(within(toc).getByText('书架中已有')).toBeVisible();
    await user.click(within(toc).getByRole('checkbox', { name: /竖排/ }));
    await user.click(
      within(toc).getByRole('button', { name: '选择全部未收藏的卷（1）' }),
    );
    expect(within(toc).getByRole('checkbox', { name: /第一部/ })).toBeChecked();
    await user.click(
      within(toc).getByRole('button', { name: '获取所选 1 卷' }),
    );

    const outcomes = await screen.findByRole('list', { name: '获取结果' });
    expect(await within(outcomes).findByText('已加入书架')).toBeVisible();
    expect(within(outcomes).getByText(/结构校验通过/)).not.toBeVisible();
    await user.click(within(outcomes).getByText('验收详情'));
    expect(within(outcomes).getByText(/结构校验通过/)).toBeVisible();
    expect(importBytes.mock.calls[0]?.[2]).toMatchObject({
      source: 'syosetu',
      volumeId: '1',
    });
  });
});
