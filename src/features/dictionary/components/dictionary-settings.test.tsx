import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AppError } from '../../../lib/app-error';
import type { InstalledDictionary } from '../domain/dictionary';
import { DictionarySettings } from './dictionary-settings';

const installed: InstalledDictionary = {
  id: 'd1',
  name: '英汉词典',
  wordCount: 12_345,
  typeSequence: 'm',
  hasSynonyms: false,
  sizeBytes: 3 * 1024 * 1024,
  createdAt: 1,
};

function setup(items: InstalledDictionary[] = []) {
  let current = [...items];
  const dictionary = {
    list: vi.fn(() => Promise.resolve(current)),
    importDictionary: vi.fn(() => {
      current = [...current, installed];
      return Promise.resolve(installed);
    }),
    remove: vi.fn((item: InstalledDictionary) => {
      current = current.filter((entry) => entry.id !== item.id);
      return Promise.resolve();
    }),
  };
  const picker = {
    pick: vi.fn(() =>
      Promise.resolve([{ fileName: 'a.ifo', data: new Uint8Array() }]),
    ),
  };
  render(<DictionarySettings dictionary={dictionary} picker={picker} />);
  return { dictionary, picker };
}

describe('DictionarySettings', () => {
  it('imports a dictionary and lists it', async () => {
    const user = userEvent.setup();
    const { dictionary } = setup();

    expect(await screen.findByText('尚未导入词典。')).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: '导入 StarDict 词典' }),
    );

    expect(await screen.findByText('已导入《英汉词典》')).toBeVisible();
    expect(dictionary.importDictionary).toHaveBeenCalledWith([
      { fileName: 'a.ifo', data: new Uint8Array() },
    ]);
    const list = await screen.findByRole('list');
    expect(within(list).getByText('英汉词典')).toBeVisible();
    expect(within(list).getByText('12,345 个词条 · 3.0 MB')).toBeVisible();
  });

  it('removes a dictionary', async () => {
    const user = userEvent.setup();
    const { dictionary } = setup([installed]);

    await user.click(
      await screen.findByRole('button', { name: '删除词典《英汉词典》' }),
    );

    expect(await screen.findByText('已删除《英汉词典》')).toBeVisible();
    expect(dictionary.remove).toHaveBeenCalledWith(installed);
    expect(await screen.findByText('尚未导入词典。')).toBeVisible();
  });

  it('does nothing on cancel and reports import errors', async () => {
    const user = userEvent.setup();
    const { dictionary, picker } = setup();
    await screen.findByText('尚未导入词典。');

    picker.pick.mockResolvedValueOnce(null as never);
    await user.click(
      screen.getByRole('button', { name: '导入 StarDict 词典' }),
    );
    expect(dictionary.importDictionary).not.toHaveBeenCalled();

    dictionary.importDictionary.mockRejectedValueOnce(
      new AppError('DICTIONARY_INVALID'),
    );
    await user.click(
      screen.getByRole('button', { name: '导入 StarDict 词典' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '词典文件不完整或格式不受支持',
    );
  });
});
