import { describe, expect, it, vi } from 'vitest';

import { createUuid } from './id';

describe('createUuid', () => {
  it('uses the platform UUID implementation when available', () => {
    const randomUuid = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('00000000-0000-4000-8000-000000000001');

    expect(createUuid()).toBe('00000000-0000-4000-8000-000000000001');
    expect(randomUuid).toHaveBeenCalledOnce();
  });

  it('generates a version 4 UUID when randomUUID is unavailable', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      globalThis.crypto,
      'randomUUID',
    );
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      value: undefined,
    });
    const randomValues = vi
      .spyOn(globalThis.crypto, 'getRandomValues')
      .mockImplementation((array) => {
        new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(
          0xaa,
        );
        return array;
      });

    try {
      expect(createUuid()).toBe('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
      expect(randomValues).toHaveBeenCalledOnce();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(
          globalThis.crypto,
          'randomUUID',
          originalDescriptor,
        );
      } else {
        Reflect.deleteProperty(globalThis.crypto, 'randomUUID');
      }
    }
  });
});
