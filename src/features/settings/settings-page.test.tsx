import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ReaderSettingsRepository } from '../../database/repositories/reader-settings-repository';
import { defaultReaderSettings } from '../reader/domain/reader-settings';
import { SettingsPage } from './settings-page';

function createRepository(): ReaderSettingsRepository {
  return {
    getGlobal: () => Promise.resolve(defaultReaderSettings),
    saveGlobal: (settings) => Promise.resolve(settings),
    getBookOverride: () => Promise.resolve(null),
    saveBookOverride: (_bookId, settings) => Promise.resolve(settings),
    deleteBookOverride: () => Promise.resolve(),
    getReadingState: () => Promise.resolve(null),
    saveReadingState: (bookId, locator) =>
      Promise.resolve({ bookId, locator, updatedAt: 1 }),
  };
}

describe('SettingsPage', () => {
  it('loads and persists global reader theme and typography', async () => {
    const user = userEvent.setup();
    const repository = createRepository();
    const saveGlobal = vi.spyOn(repository, 'saveGlobal');
    render(<SettingsPage settingsRepository={repository} />);

    const theme = await screen.findByLabelText('阅读主题');
    await user.selectOptions(theme, 'sepia');
    fireEvent.change(screen.getByLabelText('字号'), {
      target: { value: '22' },
    });
    await user.click(screen.getByRole('button', { name: '保存全局设置' }));

    await waitFor(() => {
      expect(saveGlobal).toHaveBeenCalledWith({
        ...defaultReaderSettings,
        theme: 'sepia',
        fontSize: 22,
      });
    });
    expect(screen.getByText('阅读设置已保存')).toBeInTheDocument();
  });

  it('shows a recoverable error when settings cannot load', async () => {
    const repository = createRepository();
    vi.spyOn(repository, 'getGlobal').mockRejectedValue(new Error('offline'));
    render(<SettingsPage settingsRepository={repository} />);

    expect(
      await screen.findByText('设置加载或保存失败，请重试'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存全局设置' })).toBeEnabled();
  });
});
