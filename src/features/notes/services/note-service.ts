import type { NoteRepository } from '../../../database/repositories/note-repository';
import type { Annotation } from '../../annotations/domain/annotation';
import {
  createBookQuoteNode,
  createEmptyNoteDocument,
  extractPlainText,
  noteSaveInputSchema,
  noteSchema,
  type Note,
  type NoteSaveInput,
} from '../domain/note';

type IdFactory = () => string;
type Clock = () => number;

export class NoteService {
  private readonly saveQueues = new Map<string, Promise<void>>();
  private readonly repository: NoteRepository;
  private readonly createId: IdFactory;
  private readonly now: Clock;

  constructor(
    repository: NoteRepository,
    createId: IdFactory = () => crypto.randomUUID(),
    now: Clock = () => Date.now(),
  ) {
    this.repository = repository;
    this.createId = createId;
    this.now = now;
  }

  list(titleQuery = ''): Promise<Note[]> {
    return this.repository.list(titleQuery);
  }

  findById(id: string): Promise<Note | null> {
    return this.repository.findById(id);
  }

  createEmpty(): Promise<Note> {
    const document = createEmptyNoteDocument();
    const now = this.now();
    return this.repository.create(
      noteSchema.parse({
        id: this.createId(),
        title: '未命名笔记',
        document,
        plainText: '',
        documentRecovered: false,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  createFromAnnotation(
    annotation: Annotation,
    bookTitle: string,
  ): Promise<Note> {
    const document = {
      schemaVersion: 1 as const,
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph' },
          createBookQuoteNode({
            bookId: annotation.bookId,
            annotationId: annotation.id,
            quote: annotation.text,
            chapter: annotation.chapterHref,
            locator: annotation.locator,
          }),
          { type: 'paragraph' },
        ],
      },
    };
    const now = this.now();
    return this.repository.create(
      noteSchema.parse({
        id: this.createId(),
        title: `关于《${bookTitle}》的笔记`.slice(0, 500),
        document,
        plainText: extractPlainText(document),
        documentRecovered: false,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  save(noteId: string, value: NoteSaveInput): Promise<Note> {
    const input = noteSaveInputSchema.parse(value);
    const previous = this.saveQueues.get(noteId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(() => this.repository.update(noteId, input));
    const settled = operation.then(
      () => undefined,
      () => undefined,
    );
    this.saveQueues.set(noteId, settled);
    void settled.then(() => {
      if (this.saveQueues.get(noteId) === settled) {
        this.saveQueues.delete(noteId);
      }
    });
    return operation;
  }

  async flush(noteId: string): Promise<void> {
    await this.saveQueues.get(noteId);
  }

  async delete(noteId: string): Promise<void> {
    await this.flush(noteId);
    await this.repository.delete(noteId);
  }
}
