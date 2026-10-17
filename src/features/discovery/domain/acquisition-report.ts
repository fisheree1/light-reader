import type { BookOrigin } from '../../library/domain/book-origin';
import type { EpubValidation } from '../services/epub-validator';
import { DiscoveryError } from './discovery-error';

/** Below this many characters, a chapter without images is flagged. */
export const SHORT_CHAPTER_CHARACTERS = 100;

export interface ChapterReport {
  title: string;
  pages: number;
  characters: number;
  images: number;
}

/**
 * What an acquisition fetched and built, for checking a real volume against
 * its source by hand (see docs/online-book-discovery-acceptance.md).
 */
export interface AcquisitionReport {
  source: BookOrigin['source'];
  novelId: string;
  volumeId: string;
  title: string;
  expectedChapters: number;
  builtChapters: number;
  pagesFetched: number;
  images: { total: number; embedded: number; missing: number };
  epubBytes: number;
  chapters: ChapterReport[];
  /** Chapter titles that came out empty or suspiciously short. */
  shortChapters: string[];
  validation: EpubValidation;
}

/** Visible characters in sanitized chapter markup. */
export function textLength(html: string): number {
  const text = html
    .replace(/<rt>[\s\S]*?<\/rt>/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:[a-z]+|#\d+|#x[\da-f]+);/gi, '_')
    .replace(/\s+/g, '');
  return Array.from(text).length;
}

export function shortChapters(chapters: readonly ChapterReport[]): string[] {
  return chapters
    .filter(
      (chapter) =>
        chapter.images === 0 && chapter.characters < SHORT_CHAPTER_CHARACTERS,
    )
    .map((chapter) => chapter.title);
}

/** The built EPUB failed structural checks; nothing was imported. */
export class EpubValidationError extends DiscoveryError {
  readonly report: AcquisitionReport;
  constructor(report: AcquisitionReport) {
    super('SOURCE_BUILD_INVALID');
    this.report = report;
  }
}
