import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ReaderTextSelection } from '../../../reader-engines/types';
import type { AnnotationColor } from '../domain/annotation';
import { SelectionToolbar } from './selection-toolbar';

const selection: ReaderTextSelection = {
  text: 'selected text',
  textBefore: 'before',
  textAfter: 'after',
  locator: {
    version: 1,
    format: 'epub',
    cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:4)',
  },
};

describe('SelectionToolbar', () => {
  it('selects a color and creates a highlight', async () => {
    const user = userEvent.setup();
    const create = vi.fn<(color: AnnotationColor) => Promise<void>>(() =>
      Promise.resolve(),
    );
    render(<SelectionToolbar onCreate={create} selection={selection} />);

    await user.click(screen.getByRole('button', { name: '蓝色高亮' }));
    await user.click(screen.getByRole('button', { name: '添加高亮' }));
    expect(create).toHaveBeenCalledWith('blue');
  });

  it('stays hidden without a valid text selection', () => {
    render(
      <SelectionToolbar onCreate={() => Promise.resolve()} selection={null} />,
    );
    expect(
      screen.queryByRole('toolbar', { name: '文字选择工具栏' }),
    ).not.toBeInTheDocument();
  });
});
