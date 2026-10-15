/** Text-to-speech through the operating system voices. */
export interface SpeechPlatform {
  isAvailable(): boolean;
  /** Resolves when speaking finishes or is stopped. */
  speak(text: string, language: string): Promise<void>;
  stop(): void;
}

const maxUtteranceLength = 220;

/**
 * Splits text at sentence boundaries into short utterances; some engines stop
 * speaking long utterances silently.
 */
export function splitForSpeech(text: string): string[] {
  const sentences =
    text
      .replace(/\s+/g, ' ')
      .trim()
      .match(/[^。！？!?.；;]+[。！？!?.；;]*/g) ?? [];
  const parts: string[] = [];
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    for (let start = 0; start < trimmed.length; start += maxUtteranceLength) {
      const part = trimmed.slice(start, start + maxUtteranceLength).trim();
      if (part) parts.push(part);
    }
  }
  return parts;
}

/** Picks a BCP 47 language for speech from book metadata or the text. */
export function speechLanguage(text: string, bookLanguage?: string | null) {
  if (bookLanguage?.trim()) return bookLanguage.trim();
  if (/[぀-ヿ]/.test(text)) return 'ja-JP';
  if (/[가-힯]/.test(text)) return 'ko-KR';
  if (/[一-鿿]/.test(text)) return 'zh-CN';
  return 'en-US';
}

export class BrowserSpeechPlatform implements SpeechPlatform {
  private readonly synthesis: SpeechSynthesis | undefined;
  private generation = 0;

  constructor(
    synthesis: SpeechSynthesis | undefined = typeof speechSynthesis ===
    'undefined'
      ? undefined
      : speechSynthesis,
  ) {
    this.synthesis = synthesis;
  }

  isAvailable(): boolean {
    return (
      this.synthesis !== undefined &&
      typeof SpeechSynthesisUtterance !== 'undefined'
    );
  }

  async speak(text: string, language: string): Promise<void> {
    const synthesis = this.synthesis;
    if (!synthesis || !this.isAvailable()) {
      throw new Error('Speech synthesis is unavailable.');
    }
    this.stop();
    const generation = this.generation;
    const voice = synthesis
      .getVoices()
      .find((item) =>
        item.lang.toLowerCase().startsWith(language.toLowerCase().slice(0, 2)),
      );
    for (const part of splitForSpeech(text)) {
      if (generation !== this.generation) return;
      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(part);
        utterance.lang = language;
        if (voice) utterance.voice = voice;
        utterance.addEventListener('end', () => {
          resolve();
        });
        utterance.addEventListener('error', () => {
          resolve();
        });
        synthesis.speak(utterance);
      });
    }
  }

  stop(): void {
    this.generation += 1;
    this.synthesis?.cancel();
  }
}
