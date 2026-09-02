import type { Book } from '../../library/domain/book';
import type { Annotation } from '../domain/annotation';
import {
  ANNOTATION_EXPORT_FORMAT_VERSION,
  createAnnotationExportDocument,
} from './annotation-export-service';

const book: Book = {
  id: 'book-1',
  title: '测试书',
  author: '作者',
  format: 'epub',
  filePath: 'light-reader/books/book-1/book.epub',
  fileHash: 'a'.repeat(64),
  coverPath: null,
  metadata: {
    title: '测试书',
    creators: ['作者'],
    language: 'zh',
    publisher: null,
    description: null,
    identifier: 'isbn-1',
  },
  fileSize: 10,
  createdAt: 1,
  updatedAt: 1,
};

const annotation: Annotation = {
  id: 'annotation-1',
  bookId: book.id,
  text: '高亮文本',
  textBefore: null,
  textAfter: null,
  chapterHref: '第一章',
  locator: {
    version: 1,
    format: 'epub',
    chapterHref: 'one.xhtml',
    cfi: 'epubcfi(/6/2)',
  },
  color: 'yellow',
  noteText: '我的批注',
  createdAt: 1,
  updatedAt: 2,
};

describe('annotation export document', () => {
  it('uses a stable version and preserves chapter and locator', () => {
    const document = createAnnotationExportDocument(
      book,
      [annotation],
      new Date('2026-09-02T00:00:00.000Z'),
    );

    expect(document).toMatchObject({
      format: 'lightreader-annotations',
      formatVersion: ANNOTATION_EXPORT_FORMAT_VERSION,
      book: { title: '测试书', identifier: 'isbn-1' },
      annotations: [
        {
          text: '高亮文本',
          note: '我的批注',
          chapter: '第一章',
          locator: annotation.locator,
        },
      ],
    });
  });
});
