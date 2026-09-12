import { describe, expect, it } from 'vitest';

import {
  sha256WithoutWebCrypto,
  WebCryptoContentHasher,
} from './content-hasher';

const ABC_SHA256 =
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('WebCryptoContentHasher', () => {
  it('uses Web Crypto when it is available', async () => {
    const hasher = new WebCryptoContentHasher(globalThis.crypto.subtle);

    await expect(hasher.sha256(new TextEncoder().encode('abc'))).resolves.toBe(
      ABC_SHA256,
    );
  });

  it('keeps imports working without a secure Web Crypto context', async () => {
    const data = new TextEncoder().encode('abc');
    const hasher = new WebCryptoContentHasher(null);

    expect(sha256WithoutWebCrypto(data)).toBe(ABC_SHA256);
    await expect(hasher.sha256(data)).resolves.toBe(ABC_SHA256);
  });
});
