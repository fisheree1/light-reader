import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FixtureBangumiGateway } from '../../../test/fixtures/bangumi-gateway';
import { BangumiService } from './bangumi-service';
import { TranslationLookup, type LookupRequest } from './translation-lookup';

function renderLookup(request: LookupRequest | null, onSearch = vi.fn()) {
  const services = new BangumiService(new FixtureBangumiGateway());
  const view = render(
    <TranslationLookup
      disabled={false}
      onSearch={onSearch}
      request={request}
      services={services}
    />,
  );
  return {
    ...view,
    rerenderWith: (next: LookupRequest | null) => {
      view.rerender(
        <TranslationLookup
          disabled={false}
          onSearch={onSearch}
          request={next}
          services={services}
        />,
      );
    },
  };
}

describe('TranslationLookup', () => {
  it('opens the best match with its editions and searches its Chinese titles', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    renderLookup({ text: 'テスト', id: 1 }, onSearch);

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

    // The other matches stay one click away.
    await user.click(
      screen.getByRole('button', { name: '不是这部？（还有 1 个匹配）' }),
    );
    await user.click(screen.getByRole('button', { name: /另一部测试作品/ }));
    expect(
      await screen.findByRole('article', {
        name: '《另一部测试作品》的中文信息',
      }),
    ).toBeVisible();
  });

  it('shows nothing before a search or when Bangumi knows no such work', async () => {
    const search = vi.spyOn(FixtureBangumiGateway.prototype, 'search');
    const { container, rerenderWith } = renderLookup(null);
    expect(container).toBeEmptyDOMElement();
    rerenderWith({ text: '无结果', id: 1 });
    await waitFor(() => {
      expect(search).toHaveBeenCalledWith('无结果', expect.any(AbortSignal));
    });
    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
    search.mockRestore();
  });
});
