import { useCallback, useEffect, useRef, useState } from 'react';

import {
  speechLanguage,
  type SpeechPlatform,
} from '../../../platform/speech/speech-platform';

/** Speaks text with system voices and tracks whether speech is in progress. */
export function useSpeech(
  speech: SpeechPlatform,
  bookLanguage?: string | null,
) {
  const [speaking, setSpeaking] = useState(false);
  const run = useRef(0);

  const stop = useCallback(() => {
    run.current += 1;
    speech.stop();
    setSpeaking(false);
  }, [speech]);

  const speak = useCallback(
    async (text: string) => {
      const current = (run.current += 1);
      setSpeaking(true);
      try {
        await speech.speak(text, speechLanguage(text, bookLanguage));
      } finally {
        if (run.current === current) setSpeaking(false);
      }
    },
    [speech, bookLanguage],
  );

  useEffect(
    () => () => {
      speech.stop();
    },
    [speech],
  );

  return { available: speech.isAvailable(), speaking, speak, stop };
}
