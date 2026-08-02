import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { PreparedBackup } from '../domain/backup';
import type { BackupManager } from '../services/backup-service';
import { BackupSettings } from './backup-settings';

const prepared: PreparedBackup = {
  counts: { annotations: 3, books: 1, notes: 2, readingStates: 1 },
  createdAt: '2026-08-01T10:00:00.000Z',
  schemaVersion: 8,
  token: 'snapshot-1',
};

function createManager(): BackupManager {
  return {
    available: true,
    discardPreparedBackup: () => Promise.resolve(),
    exportBackup: () =>
      Promise.resolve({
        fileName: 'LightReader.lightreader-backup',
        status: 'exported',
      }),
    prepareImport: () =>
      Promise.resolve({ backup: prepared, status: 'prepared' }),
    restoreBackup: () => Promise.resolve({ status: 'restored' }),
  };
}

describe('BackupSettings', () => {
  it('exports a local backup with user-visible success feedback', async () => {
    const user = userEvent.setup();
    render(<BackupSettings manager={createManager()} />);

    await user.click(screen.getByRole('button', { name: '导出备份' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'LightReader.lightreader-backup',
    );
  });

  it('validates first and requires explicit confirmation before restore', async () => {
    const user = userEvent.setup();
    const manager = createManager();
    const restore = vi.spyOn(manager, 'restoreBackup');
    render(<BackupSettings manager={manager} />);

    await user.click(screen.getByRole('button', { name: '导入备份' }));
    expect(
      await screen.findByRole('heading', { name: '备份已通过恢复前验证' }),
    ).toBeVisible();
    expect(restore).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '确认恢复' }));
    expect(restore).toHaveBeenCalledWith(prepared);
    expect(await screen.findByRole('status')).toHaveTextContent('备份恢复完成');
  });

  it('shows a friendly validation error and allows retry', async () => {
    const user = userEvent.setup();
    const manager = createManager();
    vi.spyOn(manager, 'prepareImport')
      .mockRejectedValueOnce(new Error('corrupt'))
      .mockResolvedValueOnce({ backup: prepared, status: 'prepared' });
    render(<BackupSettings manager={manager} />);

    await user.click(screen.getByRole('button', { name: '导入备份' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '备份文件已损坏',
    );

    await user.click(screen.getByRole('button', { name: '导入备份' }));
    expect(
      await screen.findByRole('heading', { name: '备份已通过恢复前验证' }),
    ).toBeVisible();
  });

  it('states that data changed when restore committed but reopening failed', async () => {
    const user = userEvent.setup();
    const manager = createManager();
    vi.spyOn(manager, 'restoreBackup').mockResolvedValue({
      status: 'restored-reopen-required',
    });
    render(<BackupSettings manager={manager} />);

    await user.click(screen.getByRole('button', { name: '导入备份' }));
    await user.click(screen.getByRole('button', { name: '确认恢复' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('数据已经恢复');
    expect(screen.getByRole('alert')).toHaveTextContent('重新启动应用');
  });

  it('disables native backup actions in Web preview', () => {
    const manager = createManager();
    Object.defineProperty(manager, 'available', { value: false });
    render(<BackupSettings manager={manager} />);

    expect(
      screen.queryByRole('button', { name: '导出备份' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/仅在 Tauri 桌面应用中可用/)).toBeVisible();
  });
});
