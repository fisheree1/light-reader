import * as Tooltip from '@radix-ui/react-tooltip';
import { useEffect, useState, type PropsWithChildren } from 'react';

import {
  isLocaleLoaded,
  loadLocale,
  resolveLocale,
  setActiveLocale,
} from '../../i18n/i18n';
import { useAppStore } from '../../stores/app-store';

export function AppProviders({ children }: PropsWithChildren) {
  const theme = useAppStore((state) => state.theme);
  const locale = useAppStore((state) => resolveLocale(state.locale));
  const [loadedLocale, setLoadedLocale] = useState(() =>
    isLocaleLoaded(locale) ? locale : null,
  );
  const ready = loadedLocale === locale || isLocaleLoaded(locale);
  // Set during render so errors and services created below use it at once.
  if (ready) setActiveLocale(locale);

  useEffect(() => {
    let cancelled = false;
    void loadLocale(locale).then(
      () => {
        if (!cancelled) setLoadedLocale(locale);
      },
      // A missing catalog falls back to Chinese messages.
      () => {
        if (!cancelled) setLoadedLocale(locale);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    if (ready) document.documentElement.lang = locale;
  }, [locale, ready]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
  }, [theme]);

  // The English catalog is a small local chunk; wait for it to avoid a flash
  // of Chinese text before switching.
  if (!ready) return null;
  return <Tooltip.Provider delayDuration={350}>{children}</Tooltip.Provider>;
}
