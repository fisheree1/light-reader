import { z } from 'zod';

import { bookLocatorSchema } from '../../../reader-engines/types';

export const readerThemeSchema = z.enum(['light', 'sepia', 'dark']);
export const readerFontFamilySchema = z.enum([
  'publisher',
  'serif',
  'sans-serif',
]);

export const readerDisplaySettingsSchema = z.object({
  theme: readerThemeSchema,
  fontFamily: readerFontFamilySchema,
  fontWeight: z.number().int().min(300).max(700),
  fontSize: z.number().int().min(12).max(36),
  lineHeight: z.number().min(1.2).max(2.4),
  contentWidth: z.number().int().min(420).max(1200),
  margin: z.number().int().min(0).max(96),
});

export const readerSettingsOverrideSchema =
  readerDisplaySettingsSchema.partial();

export const readingStateSchema = z.object({
  bookId: z.string().trim().min(1).max(128),
  locator: bookLocatorSchema,
  updatedAt: z.number().int().nonnegative(),
});

export type ReaderTheme = z.infer<typeof readerThemeSchema>;
export type ReaderFontFamily = z.infer<typeof readerFontFamilySchema>;
export type ReaderDisplaySettings = z.infer<typeof readerDisplaySettingsSchema>;
export type ReaderSettingsOverride = z.infer<
  typeof readerSettingsOverrideSchema
>;
export type ReadingState = z.infer<typeof readingStateSchema>;

export const defaultReaderSettings: ReaderDisplaySettings = {
  theme: 'light',
  fontFamily: 'serif',
  fontWeight: 400,
  fontSize: 18,
  lineHeight: 1.6,
  contentWidth: 720,
  margin: 32,
};

export function resolveReaderSettings(
  globalSettings: ReaderDisplaySettings,
  override: ReaderSettingsOverride | null,
): ReaderDisplaySettings {
  return readerDisplaySettingsSchema.parse({
    ...globalSettings,
    ...override,
  });
}
