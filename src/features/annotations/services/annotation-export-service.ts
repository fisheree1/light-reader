import type { FileExportPlatform } from '../../../platform/export/file-export-platform';
import type { Book } from '../../library/domain/book';
import type { Annotation } from '../domain/annotation';
import { AppError } from '../../../lib/app-error';
import { translate } from '../../../i18n/i18n';

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
    `# ${translate('annotations.exportHeading', { title: book.title })}`,
    '',
    `- ${translate('annotations.exportFormatLine', {
      format: `lightreader-annotations v${String(ANNOTATION_EXPORT_FORMAT_VERSION)}`,
    })}`,
    `- ${translate('annotations.exportTime', { time: exportedAt.toISOString() })}`,
    `- ${translate('annotations.exportAuthor', {
      author: book.author ?? translate('annotations.unknown'),
    })}`,
    '',
  ];
  const renderLocation = (annotation: Annotation): string => {
    const locator = annotation.locator;
    if (locator.format === 'epub') {
      return (
        locator.cfi ?? locator.chapterHref ?? translate('annotations.unknown')
      );
    }
    const range = locator.textRange
      ? translate('annotations.charRange', {
          start: locator.textRange.start,
          end: locator.textRange.end,
        })
      : '';
    return translate('annotations.page', {
      page: locator.pageIndex + 1,
      range,
    });
  };
  for (const [index, annotation] of annotations.entries()) {
    lines.push(
      `## ${String(index + 1)}. ${
        annotation.chapterHref ?? translate('annotations.unknownChapter')
      }`,
      '',
      `> ${annotation.text.replaceAll('\n', '\n> ')}`,
      '',
      annotation.noteText
        ? translate('annotations.exportNote', { note: annotation.noteText })
        : translate('annotations.exportNoNote'),
      '',
      translate('annotations.exportLocation', {
        location: renderLocation(annotation),
      }),
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
        defaultFileName: `${translate('annotations.exportFileName', {
          title: safeFileName(book.title),
        })}.${extension}`,
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
