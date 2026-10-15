import {
  detectChineseScript,
  normalizeTitleKey,
  searchQueryVariants,
  toSimplified,
  toTraditional,
} from './chinese-script';

describe('Chinese script helpers', () => {
  it('converts characters in both directions', () => {
    expect(toTraditional('败北女角太多了')).toBe('敗北女角太多了');
    expect(toSimplified('敗北女角太多了')).toBe('败北女角太多了');
    expect(toTraditional('轻小说 Vol.1')).toBe('輕小說 Vol.1');
  });

  it('detects the script only from distinguishing characters', () => {
    expect(detectChineseScript('这是一本轻小说的简体译本')).toBe('hans');
    expect(detectChineseScript('這是一本輕小說的繁體譯本')).toBe('hant');
    expect(detectChineseScript('这是輕小說，这里有說明')).toBe('mixed');
    expect(detectChineseScript('上下')).toBe('unknown');
    expect(detectChineseScript('Volume 1')).toBe('unknown');
  });

  it('offers at most the typed query plus the other script', () => {
    expect(searchQueryVariants(' 败北女角太多了 ')).toEqual([
      '败北女角太多了',
      '敗北女角太多了',
    ]);
    expect(searchQueryVariants('敗北女角太多了')).toEqual([
      '敗北女角太多了',
      '败北女角太多了',
    ]);
    expect(searchQueryVariants('Overlord')).toEqual(['Overlord']);
  });

  it('normalizes titles across scripts, widths and punctuation', () => {
    expect(normalizeTitleKey('《敗北女角太多了！》')).toBe(
      normalizeTitleKey('败北女角太多了!'),
    );
    expect(normalizeTitleKey('ＯＶＥＲＬＯＲＤ 不死者之王')).toBe(
      normalizeTitleKey('overlord不死者之王'),
    );
    expect(normalizeTitleKey('第一卷')).not.toBe(normalizeTitleKey('第二卷'));
  });
});
