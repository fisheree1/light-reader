import { render, screen } from '@testing-library/react';
import { RouterProvider } from 'react-router-dom';

import { createTestRouter } from '../router/router';

describe('AppLayout', () => {
  it('renders the primary navigation', () => {
    render(<RouterProvider router={createTestRouter(['/library'])} />);

    const navigation = screen.getByRole('navigation', { name: '主导航' });
    expect(navigation).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '书架' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '笔记' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '设置' })).toBeInTheDocument();
  });
});
