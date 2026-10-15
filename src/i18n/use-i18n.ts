import { useCallback } from 'react';

import { useAppStore } from '../stores/app-store';
import {
  intlLocale,
  resolveLocale,
  translate,
  type AppLocale,
  type MessageKey,
  type MessageParams,
} from './i18n';

export interface I18n {
  formatDate: (value: number, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number) => string;
  locale: AppLocale;
  t: (key: MessageKey, params?: MessageParams) => string;
}

/** Translations for the current interface language; re-renders on change. */
export function useI18n(): I18n {
  const locale = useAppStore((state) => resolveLocale(state.locale));
  const t = useCallback(
    (key: MessageKey, params?: MessageParams) => translate(key, params, locale),
    [locale],
  );
  const formatDate = useCallback(
    (value: number, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(
        intlLocale(locale),
        options ?? { dateStyle: 'medium', timeStyle: 'short' },
      ).format(value),
    [locale],
  );
  const formatNumber = useCallback(
    (value: number) => new Intl.NumberFormat(intlLocale(locale)).format(value),
    [locale],
  );
  return { formatDate, formatNumber, locale, t };
}
