import { z } from 'zod';

import {
  readerDisplaySettingsSchema,
  readerSettingsOverrideSchema,
  readingStateSchema,
  type ReaderDisplaySettings,
  type ReaderSettingsOverride,
  type ReadingState,
} from '../../features/reader/domain/reader-settings';
import { bookLocatorSchema } from '../../reader-engines/types';

export interface ReaderSettingsRecord {
  content_width: number;
  font_family: string;
  font_size: number;
  font_weight: number;
  line_height: number;
  margin: number;
  theme: string;
}

export interface BookReaderSettingsRecord {
  content_width: number | null;
  font_family: string | null;
  font_size: number | null;
  font_weight: number | null;
  line_height: number | null;
  margin: number | null;
  theme: string | null;
}

export interface ReadingStateRecord {
  book_id: string;
  locator_json: string;
  updated_at: number;
}

export function mapReaderSettingsRecord(
  row: ReaderSettingsRecord,
): ReaderDisplaySettings {
  return readerDisplaySettingsSchema.parse({
    theme: row.theme,
    fontFamily: row.font_family,
    fontWeight: row.font_weight,
    fontSize: row.font_size,
    lineHeight: row.line_height,
    contentWidth: row.content_width,
    margin: row.margin,
  });
}

export function mapBookReaderSettingsRecord(
  row: BookReaderSettingsRecord,
): ReaderSettingsOverride {
  return readerSettingsOverrideSchema.parse({
    ...(row.theme === null ? {} : { theme: row.theme }),
    ...(row.font_family === null ? {} : { fontFamily: row.font_family }),
    ...(row.font_weight === null ? {} : { fontWeight: row.font_weight }),
    ...(row.font_size === null ? {} : { fontSize: row.font_size }),
    ...(row.line_height === null ? {} : { lineHeight: row.line_height }),
    ...(row.content_width === null ? {} : { contentWidth: row.content_width }),
    ...(row.margin === null ? {} : { margin: row.margin }),
  });
}

export function mapReadingStateRecord(row: ReadingStateRecord): ReadingState {
  const locator = bookLocatorSchema.parse(JSON.parse(row.locator_json));
  return readingStateSchema.parse({
    bookId: row.book_id,
    locator,
    updatedAt: row.updated_at,
  });
}

export const validBookIdSchema = z.string().trim().min(1).max(128);
