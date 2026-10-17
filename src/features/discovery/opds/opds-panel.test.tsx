import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { createTestBook } from '../../../test/fixtures/web-records';
import {
  FixtureOpdsGateway,
  OPDS_FIXTURE_ROOT,
} from '../../../test/fixtures/opds-gateway';
import type { BookImporter } from '../../library/services/book-import-service';
import { useOpdsCatalogs } from './opds-catalog-store';
import { OpdsPanel } from './opds-panel';
import { OpdsService } from './opds-service';

describe('OpdsPanel', () => {
  beforeEach(() => {
    useOpdsCatalogs.setState({ catalogs: [] });
  });

  it('adds a catalog, browses, pages, searches and imports a book', async () => {
    const user = userEvent.setup();
    const importBytes = vi
      .fn<NonNullable<BookImporter['importBytes']>>()
      .mockResolvedValue({ status: 'created', book: createTestBook() });
    render(
      <MemoryRouter>
        <OpdsPanel
          services={
            new OpdsService(new FixtureOpdsGateway(), {
              importEpub: vi.fn(),
              importBytes,
            })
          }
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('添加一个 OPDS 书库')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Project Gutenberg' }),
    ).toBeVisible();
    await user.type(screen.getByLabelText('OPDS 地址'), 'ftp://x');
    await user.click(screen.getByRole('button', { name: '添加书库' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请输入有效');

    await user.clear(screen.getByLabelText('OPDS 地址'));
    await user.type(screen.getByLabelText('名称'), '测试书库');
    await user.type(screen.getByLabelText('OPDS 地址'), OPDS_FIXTURE_ROOT);
    await user.click(screen.getByRole('button', { name: '添加书库' }));
    await screen.findByRole('heading', { name: '测试书库', level: 2 });

    await user.click(screen.getByRole('button', { name: /最新书籍/ }));
    const book = (
      await screen.findByRole('heading', { name: '原创测试长篇' })
    ).closest('li') as HTMLElement;
    expect(
      screen.getByRole('heading', { name: '只有音频的条目' }).closest('li'),
    ).toHaveTextContent('没有可导入的格式');
    await user.click(
      within(book).getByRole('button', { name: '下载 EPUB 并加入书架' }),
    );
    expect(await within(book).findByText('已加入书架')).toBeVisible();
    expect(importBytes.mock.calls[0]?.[0]).toBe('原创测试长篇.epub');

    await user.click(screen.getByRole('button', { name: /下一页/ }));
    expect(
      await screen.findByRole('heading', { name: '第二页的书' }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: '返回' }));
    expect(
      await screen.findByRole('heading', { name: '原创测试长篇' }),
    ).toBeVisible();

    await user.type(
      screen.getByRole('searchbox', { name: '搜索 测试书库' }),
      '无结果',
    );
    await user.click(screen.getByRole('button', { name: '搜索书库' }));
    expect(await screen.findByText('这里没有条目')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '书库首页' }));
    expect(
      await screen.findByRole('heading', { name: '测试书库', level: 2 }),
    ).toBeVisible();
  });
});
