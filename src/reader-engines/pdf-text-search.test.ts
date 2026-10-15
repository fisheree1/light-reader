import {
  findPdfPageMatches,
  PdfPageTextCache,
  pdfPageProgression,
} from './pdf-text-search';

describe('findPdfPageMatches', () => {
  it('finds case-insensitive matches with context and overlay ranges', () => {
    const text = `${'x'.repeat(60)}Local first, LOCAL always.`;
    const { ranges, results } = findPdfPageMatches(text, 'local', 2, 5, 10);

    expect(ranges).toEqual([
      { start: 60, end: 65 },
      { start: 73, end: 78 },
    ]);
    expect(results[0]).toEqual({
      excerpt: {
        pre: 'x'.repeat(48),
        match: 'Local',
        post: ' first, LOCAL always.',
      },
      locator: {
        version: 1,
        format: 'pdf',
        pageIndex: 2,
        textRange: { start: 60, end: 65 },
        progression: 0.5,
      },
    });
    expect(results[1]?.excerpt.match).toBe('LOCAL');
  });

  it('respects the remaining result budget and empty queries', () => {
    expect(findPdfPageMatches('aaaa', 'a', 0, 1, 2).results).toHaveLength(2);
    expect(findPdfPageMatches('aaaa', '', 0, 1, 2).results).toEqual([]);
    expect(findPdfPageMatches('abc', 'z', 0, 1, 2)).toEqual({
      ranges: [],
      results: [],
    });
  });

  it('reports single-page documents as fully progressed', () => {
    expect(pdfPageProgression(0, 1)).toBe(1);
    expect(pdfPageProgression(3, 4)).toBe(1);
    expect(pdfPageProgression(0, 4)).toBe(0);
  });
});

describe('PdfPageTextCache', () => {
  it('evicts the least recently used page', () => {
    const cache = new PdfPageTextCache(2);
    cache.set(0, 'zero');
    cache.set(1, 'one');
    expect(cache.get(0)).toBe('zero');
    cache.set(2, 'two');

    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(0)).toBe('zero');
    expect(cache.get(2)).toBe('two');
    cache.clear();
    expect(cache.get(0)).toBeUndefined();
  });
});
