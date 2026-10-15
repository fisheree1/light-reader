import {
  classifyDictionaryFile,
  definitionToText,
  lookupCandidates,
  normalizeLookupText,
  parseStarDictInfo,
} from './dictionary';

const encode = (text: string) => new TextEncoder().encode(text);

describe('dictionary domain', () => {
  it('parses supported StarDict headers', () => {
    expect(
      parseStarDictInfo(
        "StarDict's dict ifo file\nversion=2.4.2\nbookname=测试词典\nwordcount=12\nsametypesequence=m\n",
      ),
    ).toEqual({ name: '测试词典', typeSequence: 'm', wordCount: 12 });
    expect(
      parseStarDictInfo(
        "\uFEFFStarDict's dict ifo file\r\nbookname=HTML\r\nsametypesequence=h\r\n",
      ),
    ).toMatchObject({ typeSequence: 'h', wordCount: 0 });
  });

  it('rejects unknown, multi-type, and unnamed dictionaries', () => {
    expect(parseStarDictInfo('not a dictionary')).toBeNull();
    expect(
      parseStarDictInfo(
        "StarDict's dict ifo file\nbookname=Mixed\nsametypesequence=tm\n",
      ),
    ).toBeNull();
    expect(
      parseStarDictInfo("StarDict's dict ifo file\nsametypesequence=m\n"),
    ).toBeNull();
  });

  it('classifies StarDict file roles', () => {
    expect(classifyDictionaryFile('Oxford.IFO')).toBe('ifo');
    expect(classifyDictionaryFile('oxford.idx')).toBe('idx');
    expect(classifyDictionaryFile('oxford.dict.dz')).toBe('dict');
    expect(classifyDictionaryFile('oxford.syn')).toBe('syn');
    expect(classifyDictionaryFile('oxford.dict')).toBeNull();
  });

  it('normalizes selections into lookup words', () => {
    expect(normalizeLookupText('  “Reading,”  ')).toBe('Reading');
    expect(normalizeLookupText('阅读。')).toBe('阅读');
    expect(normalizeLookupText('a b c d e')).toBeNull();
    expect(normalizeLookupText('……')).toBeNull();
    expect(normalizeLookupText('x'.repeat(65))).toBeNull();
  });

  it('suggests English base forms', () => {
    expect(lookupCandidates('Studies').slice(0, 3)).toEqual([
      'Studies',
      'studies',
      'study',
    ]);
    expect(lookupCandidates('running')).toEqual(
      expect.arrayContaining(['running', 'run', 'runn']),
    );
    expect(lookupCandidates('boxes')).toContain('box');
    expect(lookupCandidates('hoped')).toContain('hope');
    expect(lookupCandidates('阅读')).toEqual(['阅读']);
  });

  it('reduces markup definitions to plain text', () => {
    expect(definitionToText('m', encode('  plain\r\nline  '))).toBe(
      'plain\nline',
    );
    expect(
      definitionToText(
        'h',
        encode('<b>n.</b> book<br><script>alert(1)</script><p>例句</p>'),
      ),
    ).toBe('n. book\nalert(1)例句');
    expect(definitionToText('m', encode('x'.repeat(30_000)))).toHaveLength(
      20_000,
    );
  });
});
