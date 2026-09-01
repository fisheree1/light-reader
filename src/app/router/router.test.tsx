import { render, screen } from '@testing-library/react';
import { RouterProvider } from 'react-router-dom';

import { createTestRouter } from './router';
import { routes } from './routes';

describe('application routes', () => {
  it('provides hydration fallbacks for both application shells', () => {
    expect(routes[0]?.hydrateFallbackElement).toBeTruthy();
    expect(routes[1]?.hydrateFallbackElement).toBeTruthy();
  });

  it.each([
    ['/library', '书架'],
    ['/notes', '笔记'],
    ['/search', '搜索'],
    ['/settings', '设置'],
  ])('renders %s', async (path, heading) => {
    render(<RouterProvider router={createTestRouter([path])} />);

    expect(
      await screen.findByRole('heading', { level: 1, name: heading }),
    ).toBeInTheDocument();
  });
});
