import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import type { ReadingActivityRepository } from '../../database/repositories/reading-activity-repository';
import type { ReadingGoalRepository } from '../../database/repositories/reading-goal-repository';
import type { ReadingGoal } from '../reader/domain/reading-activity';
import { StatsPage } from './stats-page';

const now = new Date(2026, 9, 15, 20).getTime();
const day = (offset: number, hour = 9) =>
  new Date(2026, 9, 15 + offset, hour).getTime();

function createServices(sessionCount = 3) {
  let goal: ReadingGoal = { schemaVersion: 1, dailyMinutes: 30 };
  const activityRepository: ReadingActivityRepository = {
    startSession: vi.fn(),
    finishSession: vi.fn(),
    getStats: () =>
      Promise.resolve({
        totalSeconds: 5_400,
        sessionCount,
        booksRead: 2,
        lastReadAt: day(0),
      }),
    listSessionsSince: () =>
      Promise.resolve([
        {
          id: 'a',
          bookId: 'b1',
          startedAt: day(-2),
          endedAt: 1,
          durationSeconds: 1_800,
        },
        {
          id: 'b',
          bookId: 'b1',
          startedAt: day(-1),
          endedAt: 1,
          durationSeconds: 2_400,
        },
        {
          id: 'c',
          bookId: 'b2',
          startedAt: day(0),
          endedAt: 1,
          durationSeconds: 900,
        },
      ]),
    listBookTotals: () =>
      Promise.resolve([
        {
          bookId: 'b1',
          bookTitle: '第一本书',
          author: '作者',
          totalSeconds: 4_200,
          sessionCount: 2,
          lastReadAt: day(-1),
        },
        {
          bookId: 'b2',
          bookTitle: '第二本书',
          author: null,
          totalSeconds: 900,
          sessionCount: 1,
          lastReadAt: day(0),
        },
      ]),
    listRecent: () =>
      Promise.resolve([
        {
          bookId: 'b2',
          bookTitle: '第二本书',
          author: null,
          startedAt: day(0),
          durationSeconds: 900,
        },
      ]),
  };
  const saveGoal = vi.fn((value: ReadingGoal) => {
    goal = value;
    return Promise.resolve(value);
  });
  const goalRepository: ReadingGoalRepository = {
    get: () => Promise.resolve(goal),
    save: saveGoal,
  };
  return { activityRepository, goalRepository, saveGoal };
}

function renderPage(services = createServices()) {
  render(
    <MemoryRouter>
      <StatsPage now={now} services={services} />
    </MemoryRouter>,
  );
  return services;
}

describe('StatsPage', () => {
  it('shows totals, goal progress, streak, heatmap, and per-book time', async () => {
    renderPage();

    expect(await screen.findByText('1 小时 30 分钟')).toBeVisible();
    expect(screen.getByText('今天已读 15 / 30 分钟')).toBeVisible();
    expect(
      screen.getByRole('progressbar', { name: '今日目标进度' }),
    ).toHaveAttribute('aria-valuenow', '50');
    const overview = screen.getByRole('region', { name: '阅读概览' });
    // Yesterday and the day before met the 30-minute goal; today has not yet.
    expect(within(overview).getByText('连续达标')).toBeVisible();
    expect(within(overview).getByText('2 天')).toBeVisible();
    expect(
      screen.getByRole('img', { name: '过去 26 周中有 3 天阅读' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: /第一本书/ })).toHaveAttribute(
      'href',
      '/reader/b1',
    );
    expect(screen.getByText('1 小时 10 分钟 · 2 次')).toBeVisible();
  });

  it('validates, saves, and clears the daily goal', async () => {
    const user = userEvent.setup();
    const services = renderPage();
    const input = await screen.findByLabelText('每日分钟数');

    await user.clear(input);
    await user.type(input, '3');
    expect(screen.getByRole('button', { name: '保存目标' })).toBeDisabled();
    expect(screen.getByText('请输入 5–600 之间的整数')).toBeVisible();

    await user.clear(input);
    await user.type(input, '45');
    await user.click(screen.getByRole('button', { name: '保存目标' }));
    expect(await screen.findByText('阅读目标已保存')).toBeVisible();
    expect(services.saveGoal).toHaveBeenLastCalledWith({
      schemaVersion: 1,
      dailyMinutes: 45,
    });
    expect(screen.getByText('今天已读 15 / 45 分钟')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '取消目标' }));
    await waitFor(() => {
      expect(screen.getByText(/尚未设置目标/)).toBeVisible();
    });
    expect(screen.getByText('连续阅读')).toBeVisible();
    expect(screen.getByText('3 天')).toBeVisible();
  });

  it('reports a goal that cannot be saved', async () => {
    const user = userEvent.setup();
    const services = createServices();
    services.saveGoal.mockRejectedValueOnce(new Error('disk full'));
    renderPage(services);

    await user.click(await screen.findByRole('button', { name: '保存目标' }));
    expect(
      await screen.findByText('无法保存阅读目标，请稍后重试。'),
    ).toBeVisible();
  });

  it('shows the empty state without reading sessions', async () => {
    renderPage(createServices(0));

    expect(await screen.findByText('还没有阅读记录')).toBeVisible();
    expect(screen.getByRole('link', { name: '去书架开始阅读' })).toBeVisible();
  });

  it('shows a retryable error', async () => {
    const user = userEvent.setup();
    const services = createServices();
    const getStats = vi
      .spyOn(services.activityRepository, 'getStats')
      .mockRejectedValueOnce(new Error('locked'));
    renderPage(services);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '无法加载阅读统计',
    );
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('1 小时 30 分钟')).toBeVisible();
    expect(getStats).toHaveBeenCalledTimes(2);
  });
});
