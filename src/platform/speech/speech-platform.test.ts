import {
  BrowserSpeechPlatform,
  speechLanguage,
  splitForSpeech,
} from './speech-platform';

class FakeUtterance extends EventTarget {
  lang = '';
  voice: unknown = null;
  readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }
}

function createSynthesis() {
  const spoken: FakeUtterance[] = [];
  const cancel = vi.fn();
  const synthesis = {
    cancel,
    getVoices: () => [{ lang: 'zh-CN', name: '中文' }],
    speak: vi.fn((utterance: FakeUtterance) => {
      spoken.push(utterance);
      queueMicrotask(() => utterance.dispatchEvent(new Event('end')));
    }),
  };
  return {
    cancel,
    spoken,
    synthesis: synthesis as unknown as SpeechSynthesis,
  };
}

describe('speech platform', () => {
  beforeEach(() => {
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('splits long text into sentence-sized utterances', () => {
    expect(splitForSpeech(' 第一句。第二句！ Third one. ')).toEqual([
      '第一句。',
      '第二句！',
      'Third one.',
    ]);
    expect(splitForSpeech('长'.repeat(500))).toHaveLength(3);
    expect(splitForSpeech('   ')).toEqual([]);
  });

  it('chooses a language from book metadata or script', () => {
    expect(speechLanguage('hello', 'fr')).toBe('fr');
    expect(speechLanguage('你好')).toBe('zh-CN');
    expect(speechLanguage('こんにちは')).toBe('ja-JP');
    expect(speechLanguage('안녕')).toBe('ko-KR');
    expect(speechLanguage('hello')).toBe('en-US');
  });

  it('speaks each part with a matching voice and can stop', async () => {
    const { cancel, spoken, synthesis } = createSynthesis();
    const platform = new BrowserSpeechPlatform(synthesis);

    expect(platform.isAvailable()).toBe(true);
    await platform.speak('你好。再见。', 'zh-CN');

    expect(spoken.map((utterance) => utterance.text)).toEqual([
      '你好。',
      '再见。',
    ]);
    expect(spoken[0]).toMatchObject({ lang: 'zh-CN', voice: { name: '中文' } });
    platform.stop();
    expect(cancel).toHaveBeenCalled();
  });

  it('reports unavailable speech', async () => {
    const platform = new BrowserSpeechPlatform(undefined);

    expect(platform.isAvailable()).toBe(false);
    await expect(platform.speak('x', 'en-US')).rejects.toThrow();
  });
});
