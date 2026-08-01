import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Annotation } from '../domain/annotation';
import { AnnotationPopover } from './annotation-popover';

const annotation: Annotation = {
  id: 'annotation-1',
  bookId: 'book-1',
  text: 'selected text',
  textBefore: 'before',
  textAfter: 'after',
  chapterHref: 'EPUB/one.xhtml',
  locator: {
    version: 1,
    format: 'epub',
    chapterHref: 'EPUB/one.xhtml',
    cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:4)',
  },
  color: 'yellow',
  noteText: null,
  createdAt: 1,
  updatedAt: 1,
};

describe('AnnotationPopover', () => {
  it('auto-saves an added note and supports editing it', async () => {
    const user = userEvent.setup();
    const save = vi.fn<(id: string, noteText: string) => Promise<Annotation>>(
      (id, noteText) =>
        Promise.resolve({ ...annotation, id, noteText, updatedAt: 2 }),
    );
    render(
      <AnnotationPopover
        annotation={annotation}
        onClose={() => undefined}
        onDelete={() => Promise.resolve()}
        onSave={save}
      />,
    );

    const input = screen.getByLabelText('批注内容');
    await user.type(input, 'first note');
    await waitFor(
      () => {
        expect(save).toHaveBeenCalledWith(annotation.id, 'first note');
      },
      { timeout: 1200 },
    );
    expect(screen.getByText('已保存')).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, 'edited note');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(save).toHaveBeenLastCalledWith(annotation.id, 'edited note');
    });
  });

  it('keeps the draft editable when saving fails', async () => {
    const user = userEvent.setup();
    const save = vi.fn<(id: string, noteText: string) => Promise<Annotation>>(
      () => Promise.reject(new Error('database offline')),
    );
    render(
      <AnnotationPopover
        annotation={annotation}
        onClose={() => undefined}
        onDelete={() => Promise.resolve()}
        onSave={save}
      />,
    );

    const input = screen.getByLabelText('批注内容');
    await user.type(input, 'unsaved draft');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('保存失败，输入已保留')).toBeInTheDocument();
    expect(input).toHaveValue('unsaved draft');
  });

  it('requires confirmation before deleting a highlight and note', async () => {
    const user = userEvent.setup();
    const remove = vi.fn<(id: string) => Promise<void>>(() =>
      Promise.resolve(),
    );
    render(
      <AnnotationPopover
        annotation={{ ...annotation, noteText: 'note' }}
        onClose={() => undefined}
        onDelete={remove}
        onSave={() => Promise.resolve(annotation)}
      />,
    );

    await user.click(screen.getByRole('button', { name: '删除' }));
    expect(remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    expect(remove).toHaveBeenCalledWith(annotation.id);
  });
});
