import { describe, expect, it } from 'vitest';

import { detectSensitiveContent } from './sensitive-content';

describe('detectSensitiveContent', () => {
  it('warns about common secrets and contact data without changing text', () => {
    const text =
      '联系 reader@example.com，api_key=example-not-a-real-secret-12345，电话 +86 138 0013 8000。';
    const warnings = detectSensitiveContent(text);

    expect(warnings.map((warning) => warning.kind)).toEqual(
      expect.arrayContaining(['credential', 'email', 'phone']),
    );
    expect(text).toContain('example-not-a-real-secret');
  });
});
