import { useEffect, useRef, useState } from 'react';

/** Below this window width, only one reader side panel stays open. */
export const COMPACT_READER_WIDTH = 1200;
/** Below this window width, the table of contents also starts closed. */
export const NARROW_READER_WIDTH = 900;

export interface ReadingLayout {
  compact: boolean;
  narrow: boolean;
}

export function measureReadingLayout(): ReadingLayout {
  const width = window.innerWidth;
  return {
    compact: width < COMPACT_READER_WIDTH,
    narrow: width < NARROW_READER_WIDTH,
  };
}

/**
 * The reader's width class, following window resizes. `onShrink` runs when
 * the window becomes compact or narrow, to close panels that no longer fit.
 */
export function useReadingLayout(
  onShrink: (next: ReadingLayout, previous: ReadingLayout) => void,
): ReadingLayout {
  const [layout, setLayout] = useState(measureReadingLayout);
  const callback = useRef(onShrink);
  useEffect(() => {
    callback.current = onShrink;
  });
  useEffect(() => {
    let current = measureReadingLayout();
    const handleResize = () => {
      const next = measureReadingLayout();
      if (next.compact === current.compact && next.narrow === current.narrow)
        return;
      if (
        (next.compact && !current.compact) ||
        (next.narrow && !current.narrow)
      )
        callback.current(next, current);
      current = next;
      setLayout(next);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);
  return layout;
}
