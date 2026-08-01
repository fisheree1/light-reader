import type { NoteRepository } from '../../../database/repositories/note-repository';
import type { Annotation } from '../../annotations/domain/annotation';
import {
  createEmptyNoteDocument,
  findBookQuoteReferences,
  type Note,
} from '../domain/note';
import { NoteService } from './note-service';

const annotation: Annotation = {
  id: 'annotation-1',
  bookId: 'book-1',
  text: '被引用的原文',
  textBefore: null,
  textAfter: null,
  chapterHref: '第一章',
  locator: {
    version: 1,
    format: 'epub',
    chapterHref: 'one.xhtml',
    cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:8)',
  },
  color: 'yellow',
  noteText: null,
  createdAt: 1,
  updatedAt: 1,
};

function createRepository() {
  const notes: Note[] = [];
  const repository: NoteRepository = {
    create: (note) => {
      notes.push(note);
      return Promise.resolve(note);
    },
    findById: (id) =>
      Promise.resolve(notes.find((note) => note.id === id) ?? null),
    list: () => Promise.resolve(notes),
    update: (id, input) => {
      const current = notes.find((note) => note.id === id);
      if (!current) return Promise.reject(new Error('missing'));
      const updated = {
        ...current,
        ...input,
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
  return { notes, repository };
}

describe('NoteService', () => {
  it('creates an independent note with a quote snapshot', async () => {
    const { notes, repository } = createRepository();
    const service = new NoteService(
      repository,
      () => 'note-1',
      () => 10,
    );

    await service.createFromAnnotation(annotation, '测试书');
    // Simulate the source Annotation being deleted after the note was created.
    const sourceAnnotation: Annotation | null = null;

    expect(sourceAnnotation).toBeNull();
    const created = notes.at(0);
    expect(created).toBeDefined();
    expect(created && findBookQuoteReferences(created.document)).toEqual([
      {
        bookId: annotation.bookId,
        annotationId: annotation.id,
        quote: annotation.text,
        chapter: annotation.chapterHref,
        locator: annotation.locator,
      },
    ]);
  });

  it('serializes saves so an older completion cannot overwrite newer JSON', async () => {
    const { repository } = createRepository();
    const empty = createEmptyNoteDocument();
    const note: Note = {
      id: 'note-1',
      title: '初始',
      document: empty,
      plainText: '',
      documentRecovered: false,
      createdAt: 1,
      updatedAt: 1,
    };
    await repository.create(note);
    const resolvers: (() => void)[] = [];
    const update = vi.spyOn(repository, 'update').mockImplementation(
      (id, input) =>
        new Promise((resolve) => {
          resolvers.push(() => {
            resolve({ ...note, id, ...input });
          });
        }),
    );
    const service = new NoteService(repository);

    const first = service.save(note.id, { title: '第一版', document: empty });
    const second = service.save(note.id, { title: '第二版', document: empty });
    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledTimes(1);
    });
    resolvers[0]?.();
    await first;
    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledTimes(2);
    });
    resolvers[1]?.();
    await expect(second).resolves.toEqual(
      expect.objectContaining({ title: '第二版' }),
    );
  });
});
