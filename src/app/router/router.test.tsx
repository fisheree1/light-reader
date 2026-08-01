import { render, screen } from '@testing-library/react';
import { RouterProvider } from 'react-router-dom';

import { createTestRouter } from './router';

describe('application routes', () => {
  it.each([
    ['/library', '书架'],
    ['/notes', '笔记'],
    ['/settings', '设置'],
  ])('renders %s', async (path, heading) => {
    render(<RouterProvider router={createTestRouter([path])} />);

    expect(
      await screen.findByRole('heading', { level: 1, name: heading }),
    ).toBeInTheDocument();
  });
});
