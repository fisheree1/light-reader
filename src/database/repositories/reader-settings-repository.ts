import type {
  ReaderDisplaySettings,
  ReaderSettingsOverride,
  ReadingState,
} from '../../features/reader/domain/reader-settings';
import type { BookLocator } from '../../reader-engines/types';

export interface ReaderSettingsRepository {
  getGlobal(): Promise<ReaderDisplaySettings>;
  saveGlobal(settings: ReaderDisplaySettings): Promise<ReaderDisplaySettings>;
  getBookOverride(bookId: string): Promise<ReaderSettingsOverride | null>;
  saveBookOverride(
    bookId: string,
    settings: ReaderSettingsOverride,
  ): Promise<ReaderSettingsOverride>;
  deleteBookOverride(bookId: string): Promise<void>;
  getReadingState(bookId: string): Promise<ReadingState | null>;
  saveReadingState(bookId: string, locator: BookLocator): Promise<ReadingState>;
}
