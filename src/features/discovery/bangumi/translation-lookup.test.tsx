import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FixtureBangumiGateway } from '../../../test/fixtures/bangumi-gateway';
import { BangumiService } from './bangumi-service';
import { TranslationLookup } from './translation-lookup';

describe('TranslationLookup', () => {
  it('shows official editions and searches the sources with Chinese titles', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(
      <TranslationLookup
        disabled={false}
        onSearch={onSearch}
        services={new BangumiService(new FixtureBangumiGateway())}
      />,
    );
    await user.type(
      screen.getByRole('searchbox', { name: '作品名' }),
      'テスト',
    );
    await user.click(screen.getByRole('button', { name: '查找译名' }));

    // A single match opens directly.
    const details = await screen.findByRole('article', {
      name: '《测试轻小说》的中文信息',
    });
    expect(
      within(details).getByText(/测试出版社 · 译者：测试译者/),
    ).toBeVisible();
    expect(within(details).getByText('繁体中文')).toBeVisible();
    expect(within(details).getByText(/请通过正规书店购买/)).toBeVisible();
    expect(
      within(details).getByText('測試輕小說、测试轻小说、另一个译名'),
    ).toBeVisible();
    await user.click(
      within(details).getByRole('button', { name: '用 2 个译名搜索书源' }),
    );
    expect(onSearch).toHaveBeenCalledWith(['测试轻小说', '另一个译名']);
  });

  it('looks up a linked title and reports missing works', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TranslationLookup
        disabled={false}
        initialKeyword="テストのライトノベル"
        onSearch={vi.fn()}
        services={new BangumiService(new FixtureBangumiGateway())}
      />,
    );
    expect(await screen.findByRole('article')).toBeVisible();
    expect(screen.getByRole('searchbox')).toHaveValue('テストのライトノベル');

    rerender(
      <TranslationLookup
        disabled={false}
        initialKeyword="无结果"
        onSearch={vi.fn()}
        services={new BangumiService(new FixtureBangumiGateway())}
      />,
    );
    expect(
      await screen.findByText('Bangumi 中没有找到这部轻小说。'),
    ).toBeVisible();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox'));
    expect(screen.getByRole('button', { name: '查找译名' })).toBeDisabled();
  });
});
