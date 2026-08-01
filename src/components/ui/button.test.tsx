import { render, screen } from '@testing-library/react';

import { Button } from './button';

describe('Button', () => {
  it('renders an accessible button', () => {
    render(<Button>添加图书</Button>);

    expect(
      screen.getByRole('button', { name: '添加图书' }),
    ).toBeInTheDocument();
  });
});
