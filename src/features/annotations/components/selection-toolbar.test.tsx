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

  it('offers dictionary lookup and toggles read-aloud', async () => {
    const user = userEvent.setup();
    const lookup = vi.fn();
    const toggle = vi.fn();
    const { rerender } = render(
      <SelectionToolbar
        onCreate={() => Promise.resolve()}
        onLookup={lookup}
        selection={selection}
        speech={{ speaking: false, onToggle: toggle }}
      />,
    );

    await user.click(screen.getByRole('button', { name: '查词' }));
    await user.click(screen.getByRole('button', { name: '朗读' }));
    expect(lookup).toHaveBeenCalledOnce();
    expect(toggle).toHaveBeenCalledOnce();

    rerender(
      <SelectionToolbar
        onCreate={() => Promise.resolve()}
        selection={selection}
        speech={{ speaking: true, onToggle: toggle }}
      />,
    );
    expect(screen.getByRole('button', { name: '停止朗读' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.queryByRole('button', { name: '查词' }),
    ).not.toBeInTheDocument();
  });
});
