import {
  classifyVolumeKind,
  combineTranslationMethods,
  detectEdition,
  detectTranslationMethod,
  extractTranslators,
} from './edition';

describe('volume and translation metadata', () => {
  it('classifies volume kinds from titles', () => {
    expect(classifyVolumeKind('败北女角太多了 第1卷')).toBe('main');
    expect(classifyVolumeKind('第八卷')).toBe('main');
    expect(classifyVolumeKind('第8.5卷')).toBe('main');
    expect(classifyVolumeKind('Vol. 3')).toBe('main');
    expect(classifyVolumeKind('短篇集')).toBe('collection');
    expect(classifyVolumeKind('番外篇 夏日')).toBe('side-story');
    expect(classifyVolumeKind('外傳')).toBe('side-story');
    expect(classifyVolumeKind('特別篇')).toBe('unknown');
  });

  it('reads explicit edition labels in either script', () => {
    expect(detectEdition('第一卷（文庫版）')).toBe('文库版');
    expect(detectEdition('WEB版 第3章')).toBe('Web 版');
    expect(detectEdition('新裝版 第1卷')).toBe('新装版');
    expect(detectEdition('第1卷')).toBeNull();
  });

  it('only trusts explicit translation declarations', () => {
    expect(detectTranslationMethod('译者：某某（机翻）')).toBe('machine');
    expect(detectTranslationMethod('譯者：某某\n翻譯方式：人工翻譯')).toBe(
      'human',
    );
    expect(detectTranslationMethod('翻译方式：机翻初稿，人工校对后发布')).toBe(
      'mixed',
    );
    // Plot text that mentions machine translation is not a declaration.
    expect(detectTranslationMethod('他说这段像机翻一样生硬。')).toBe('unknown');
    expect(detectTranslationMethod('')).toBe('unknown');
  });

  it('combines methods without inventing certainty', () => {
    expect(combineTranslationMethods(['unknown', 'human', 'human'])).toBe(
      'human',
    );
    expect(combineTranslationMethods(['human', 'machine'])).toBe('mixed');
    expect(combineTranslationMethods(['unknown'])).toBe('unknown');
    expect(combineTranslationMethods([])).toBe('unknown');
  });

  it('extracts translator names in both scripts', () => {
    expect(
      extractTranslators('译者：甲\n譯者：乙（机翻）\n译者：甲\n后记'),
    ).toEqual(['甲', '乙']);
  });
});
