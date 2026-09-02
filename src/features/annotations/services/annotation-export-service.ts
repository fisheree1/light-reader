import type { FileExportPlatform } from '../../../platform/export/file-export-platform';
import type { Book } from '../../library/domain/book';
import type { Annotation } from '../domain/annotation';
import { AppError } from '../../../lib/app-error';

export const ANNOTATION_EXPORT_FORMAT_VERSION = 1;
export type AnnotationExportFormat = 'json' | 'markdown';

const encoder = new TextEncoder();

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'annotations';
}

export function createAnnotationExportDocument(
  book: Book,
  annotations: Annotation[],
  exportedAt = new Date(),
) {
  return {
    format: 'lightreader-annotations' as const,
    formatVersion: ANNOTATION_EXPORT_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    book: {
      id: book.id,
      title: book.title,
      author: book.author,
      identifier: book.metadata.identifier,
    },
    annotations: annotations.map((annotation) => ({
      id: annotation.id,
      text: annotation.text,
      note: annotation.noteText,
      color: annotation.color,
      chapter: annotation.chapterHref,
      locator: annotation.locator,
      createdAt: new Date(annotation.createdAt).toISOString(),
      updatedAt: new Date(annotation.updatedAt).toISOString(),
    })),
  };
}

function renderMarkdown(
  book: Book,
  annotations: Annotation[],
  exportedAt: Date,
): string {
  const lines = [
    `# ${book.title}：高亮与批注`,
    '',
    `- 导出格式：lightreader-annotations v${String(ANNOTATION_EXPORT_FORMAT_VERSION)}`,
    `- 导出时间：${exportedAt.toISOString()}`,
    `- 作者：${book.author ?? '未知'}`,
    '',
  ];
  for (const [index, annotation] of annotations.entries()) {
    lines.push(
      `## ${String(index + 1)}. ${annotation.chapterHref ?? '未知章节'}`,
      '',
      `> ${annotation.text.replaceAll('\n', '\n> ')}`,
      '',
      annotation.noteText ? `批注：${annotation.noteText}` : '批注：无',
      '',
      `位置：${annotation.locator.cfi ?? annotation.locator.chapterHref ?? '未知'}`,
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}

export class AnnotationExportService {
  private readonly platform: FileExportPlatform;

  constructor(platform: FileExportPlatform) {
    this.platform = platform;
  }

  async exportBook(
    book: Book,
    annotations: Annotation[],
    format: AnnotationExportFormat,
  ): Promise<void> {
    try {
      const exportedAt = new Date();
      const content =
        format === 'json'
          ? `${JSON.stringify(
              createAnnotationExportDocument(book, annotations, exportedAt),
              null,
              2,
            )}\n`
          : renderMarkdown(book, annotations, exportedAt);
      const extension = format === 'json' ? 'json' : 'md';
      const result = await this.platform.save({
        data: encoder.encode(content),
        defaultFileName: `${safeFileName(book.title)}-批注.${extension}`,
        extension,
        mediaType: format === 'json' ? 'application/json' : 'text/markdown',
      });
      if (result === 'cancelled') throw new AppError('EXPORT_CANCELLED');
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('EXPORT_FAILED', { cause: error });
    }
  }
}
