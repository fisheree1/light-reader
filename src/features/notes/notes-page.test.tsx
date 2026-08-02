import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { BookRepository } from '../../database/repositories/book-repository';
import type { NoteRepository } from '../../database/repositories/note-repository';
import { createEmptyNoteDocument, type Note } from './domain/note';
import { NotesPage } from './notes-page';
import type { NotesServices } from './services/notes-services';

function createNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    title: '恢复的笔记',
    document: {
      schemaVersion: 1,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '已有正文' }],
          },
        ],
      },
    },
    plainText: '已有正文',
    documentRecovered: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createServices(initialNotes: Note[] = []) {
  const notes = [...initialNotes];
  const noteRepository: NoteRepository = {
    create: (note) => {
      notes.unshift(note);
      return Promise.resolve(note);
    },
    findById: (id) =>
      Promise.resolve(notes.find((note) => note.id === id) ?? null),
    list: () => Promise.resolve([...notes]),
    update: (id, input) => {
      const current = notes.find((note) => note.id === id);
      if (!current) return Promise.reject(new Error('missing note'));
      const updated = {
        ...current,
        ...input,
        plainText: JSON.stringify(input.document),
        documentRecovered: false,
        updatedAt: current.updatedAt + 1,
      };
      notes.splice(notes.indexOf(current), 1, updated);
      return Promise.resolve(updated);
    },
    delete: (id) => {
      const index = notes.findIndex((note) => note.id === id);
      if (index >= 0) notes.splice(index, 1);
      return Promise.resolve();
    },
  };
  const bookRepository: BookRepository = {
    create: (book) => Promise.resolve(book),
    findById: () => Promise.resolve(null),
    findByHash: () => Promise.resolve(null),
    list: () => Promise.resolve([]),
    delete: () => Promise.resolve(),
  };
  return {
    notes,
    services: { bookRepository, noteRepository } satisfies NotesServices,
  };
}

function renderPage(services: NotesServices) {
  return render(
    <MemoryRouter initialEntries={['/notes']}>
      <Routes>
        <Route element={<NotesPage services={services} />} path="/notes" />
      </Routes>
    </MemoryRouter>,
  );
}

describe('NotesPage', () => {
  it('shows the empty state and creates an independent note', async () => {
    const user = userEvent.setup();
    const { services } = createServices();
    renderPage(services);

    expect(
      await screen.findByRole('heading', { name: '暂无笔记' }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: '新建笔记' }));
    expect(await screen.findByLabelText('笔记标题')).toHaveValue('未命名笔记');
    expect(screen.getByRole('textbox', { name: '笔记正文' })).toBeVisible();
  });

  it('edits and autosaves the canonical editor JSON', async () => {
    const user = userEvent.setup();
    const { services } = createServices([createNote()]);
    const update = vi.spyOn(services.noteRepository, 'update');
    renderPage(services);

    const editor = await screen.findByRole('textbox', { name: '笔记正文' });
    await user.click(editor);
    await user.type(editor, '新增内容');

    await waitFor(
      () => {
        expect(update).toHaveBeenCalled();
        const call = update.mock.calls.at(-1);
        expect(call?.[0]).toBe('note-1');
        expect(call?.[1].document.schemaVersion).toBe(1);
      },
      { timeout: 1800 },
    );
    expect(await screen.findByText('已保存')).toBeVisible();
  });

  it('preserves the draft and offers retry after a save failure', async () => {
    const user = userEvent.setup();
    const { services } = createServices([createNote()]);
    vi.spyOn(services.noteRepository, 'update').mockRejectedValue(
      new Error('disk full'),
    );
    renderPage(services);

    const title = await screen.findByLabelText('笔记标题');
    await user.clear(title);
    await user.type(title, '失败后保留的标题');

    expect(
      await screen.findByText('保存失败，内容已保留', {}, { timeout: 1800 }),
    ).toBeVisible();
    expect(title).toHaveValue('失败后保留的标题');
    expect(screen.getByRole('button', { name: '重试保存' })).toBeVisible();
  });

  it('recovers the synchronous draft journal after an abnormal exit', async () => {
    const user = userEvent.setup();
    const { services } = createServices([createNote()]);
    vi.spyOn(services.noteRepository, 'update').mockRejectedValue(
      new Error('process terminated before SQLite save'),
    );
    const firstRun = renderPage(services);

    const title = await screen.findByLabelText('笔记标题');
    await user.clear(title);
    await user.type(title, '异常退出前输入');
    firstRun.unmount();

    renderPage(services);
    expect(await screen.findByLabelText('笔记标题')).toHaveValue(
      '异常退出前输入',
    );
    expect(
      screen.getByText('已恢复上次异常退出前的未保存内容。'),
    ).toBeVisible();
  });

  it('does not overwrite recovered corrupt JSON when only the title changes', async () => {
    const user = userEvent.setup();
    const { services } = createServices([
      createNote({ documentRecovered: true, plainText: '原始损坏内容' }),
    ]);
    const update = vi.spyOn(services.noteRepository, 'update');
    renderPage(services);

    const title = await screen.findByLabelText('笔记标题');
    await user.clear(title);
    await user.type(title, '只修改标题');

    expect(
      await screen.findByText(
        '原笔记内容损坏；请先编辑正文，再保存恢复后的内容。',
        {},
        { timeout: 1_800 },
      ),
    ).toBeVisible();
    expect(update).not.toHaveBeenCalled();
  });

  it('searches by title and deletes after confirmation', async () => {
    const user = userEvent.setup();
    const { services, notes } = createServices([
      createNote(),
      createNote({ id: 'note-2', title: '另一条笔记' }),
    ]);
    renderPage(services);

    await screen.findByLabelText('笔记标题');
    await user.type(screen.getByLabelText('搜索笔记标题'), '恢复');
    expect(screen.getByRole('button', { name: /恢复的笔记/ })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /另一条笔记/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '删除笔记' }));
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => {
      expect(notes.map((note) => note.id)).not.toContain('note-1');
    });
  });

  it('can initialize a blank JSON document fixture', () => {
    expect(createEmptyNoteDocument().schemaVersion).toBe(1);
  });
});
