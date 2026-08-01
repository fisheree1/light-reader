import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  createBookQuoteNode,
  type BookQuoteReference,
  type Note,
} from '../domain/note';
import { NoteEditor } from './note-editor';

const reference: BookQuoteReference = {
  bookId: 'book-1',
  annotationId: 'annotation-1',
  quote: '引用块中的原文',
  chapter: '第一章',
  locator: {
    version: 1,
    format: 'epub',
    chapterHref: 'one.xhtml',
    cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:8)',
  },
};

function noteWithContent(
  content: Note['document']['content']['content'],
): Note {
  return {
    id: 'note-1',
    title: '测试笔记',
    document: {
      schemaVersion: 1,
      content: { type: 'doc', content },
    },
    plainText: '',
    documentRecovered: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('NoteEditor', () => {
  it('restores persisted JSON content', () => {
    render(
      <NoteEditor
        note={noteWithContent([
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '从 JSON 恢复的正文' }],
          },
        ])}
        onChange={vi.fn()}
        onFlush={vi.fn()}
        onNavigate={vi.fn()}
        resolveBookTitle={() => '测试书'}
      />,
    );

    expect(screen.getByText('从 JSON 恢复的正文')).toBeVisible();
    expect(
      screen.getByRole('toolbar', { name: '笔记格式工具栏' }),
    ).toBeVisible();
  });

  it('renders a quote snapshot and exposes navigation as an accessible action', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <NoteEditor
        note={noteWithContent([createBookQuoteNode(reference)])}
        onChange={vi.fn()}
        onFlush={vi.fn()}
        onNavigate={onNavigate}
        resolveBookTitle={() => '测试书'}
      />,
    );

    expect(screen.getByText('“引用块中的原文”')).toBeVisible();
    expect(screen.getByText('《测试书》 · 第一章')).toBeVisible();
    await user.click(
      screen.getByRole('button', {
        name: '返回《测试书》中的引用：引用块中的原文',
      }),
    );
    expect(onNavigate).toHaveBeenCalledWith(reference);
  });
});
