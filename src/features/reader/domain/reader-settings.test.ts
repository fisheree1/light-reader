import { describe, expect, it } from 'vitest';

import {
  defaultReaderSettings,
  readerDisplaySettingsSchema,
  resolveReaderSettings,
} from './reader-settings';

describe('reader settings domain', () => {
  it('resolves a partial per-book override over global settings', () => {
    expect(
      resolveReaderSettings(defaultReaderSettings, {
        theme: 'sepia',
        fontSize: 22,
      }),
    ).toEqual({
      ...defaultReaderSettings,
      theme: 'sepia',
      fontSize: 22,
    });
  });

  it('rejects unsafe display values at runtime', () => {
    expect(() =>
      readerDisplaySettingsSchema.parse({
        ...defaultReaderSettings,
        fontSize: 200,
      }),
    ).toThrow();
  });
});
