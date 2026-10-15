import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import type { DictionaryLookupResult } from '../services/dictionary-service';
import { DictionaryPanel } from './dictionary-panel';

function renderPanel(
  lookup: (text: string) => Promise<DictionaryLookupResult>,
  canSpeak = true,
) {
  const onSpeak = vi.fn();
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <DictionaryPanel
        canSpeak={canSpeak}
        dictionary={{ lookup }}
        onClose={onClose}
        onSpeak={onSpeak}
        text="Books,"
      />
    </MemoryRouter>,
  );
  return { onClose, onSpeak };
}

describe('DictionaryPanel', () => {
  it('shows grouped definitions and speaks the looked-up word', async () => {
    const user = userEvent.setup();
    const { onClose, onSpeak } = renderPanel(() =>
      Promise.resolve({
        status: 'done',
        word: 'Books',
        entries: [
          {
            dictionaryId: 'd1',
            dictionaryName: '英汉词典',
            word: 'book',
            definition: 'n. 书\nv. 预订',
          },
        ],
      }),
    );

    expect(
      await screen.findByRole('region', { name: '英汉词典' }),
    ).toBeVisible();
    expect(screen.getByText('book')).toBeVisible();
    expect(screen.getByText(/n\. 书/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: '朗读词条' }));
    expect(onSpeak).toHaveBeenCalledWith('Books');
    await user.click(screen.getByRole('button', { name: '关闭词典' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('guides the user to import a dictionary', async () => {
    renderPanel(() => Promise.resolve({ status: 'no-dictionaries' }), false);

    expect(await screen.findByText('尚未导入词典')).toBeVisible();
    expect(screen.getByRole('link', { name: '前往设置导入' })).toHaveAttribute(
      'href',
      '/settings#dictionaries',
    );
    expect(
      screen.queryByRole('button', { name: '朗读词条' }),
    ).not.toBeInTheDocument();
  });

  it('explains empty results, long selections, and errors', async () => {
    const { unmount } = render(
      <MemoryRouter>
        <DictionaryPanel
          canSpeak={false}
          dictionary={{
            lookup: () =>
              Promise.resolve({ status: 'done', word: 'zebra', entries: [] }),
          }}
          onClose={vi.fn()}
          onSpeak={vi.fn()}
          text="zebra"
        />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText('已导入的词典中没有找到这个词。'),
    ).toBeVisible();
    unmount();

    renderPanel(() => Promise.resolve({ status: 'invalid-selection' }));
    expect(await screen.findByText(/请选择一个单词或短语/)).toBeVisible();
  });

  it('shows a read error', async () => {
    renderPanel(() => Promise.reject(new Error('broken')));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '无法读取已导入的词典',
    );
  });
});
