export interface ContentHasher {
  sha256(data: Uint8Array): Promise<string>;
}

export class WebCryptoContentHasher implements ContentHasher {
  async sha256(data: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      Uint8Array.from(data).buffer,
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
  }
}
