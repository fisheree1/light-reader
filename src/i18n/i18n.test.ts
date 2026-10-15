import { act, renderHook } from '@testing-library/react';

import { useAppStore } from '../stores/app-store';
import {
  detectLocale,
  getActiveLocale,
  intlLocale,
  isLocaleLoaded,
  loadLocale,
  resolveLocale,
  setActiveLocale,
  translate,
} from './i18n';
import { en } from './messages/en';
import { zhCN } from './messages/zh-CN';
import { useI18n } from './use-i18n';

function leafKeys(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === 'string'
      ? [`${prefix}${key}`]
      : leafKeys(child as object, `${prefix}${key}.`),
  );
}

describe('i18n', () => {
  beforeAll(async () => {
    await loadLocale('en');
  });

  it('detects Chinese and English browser languages', () => {
    expect(detectLocale(['zh-TW', 'en'])).toBe('zh-CN');
    expect(detectLocale(['fr-FR', 'en-GB'])).toBe('en');
    expect(detectLocale(['fr-FR'])).toBe('zh-CN');
    expect(resolveLocale('en')).toBe('en');
    expect(intlLocale('en')).toBe('en-US');
    expect(intlLocale('zh-CN')).toBe('zh-CN');
    expect(isLocaleLoaded('en')).toBe(true);
    expect(isLocaleLoaded('zh-CN')).toBe(true);
  });

  it('translates with placeholders and the active locale', () => {
    expect(translate('library.openBook', { title: '三体' }, 'zh-CN')).toBe(
      '打开《三体》',
    );
    expect(translate('library.openBook', { title: 'Dune' }, 'en')).toBe(
      'Open “Dune”',
    );
    expect(translate('stats.days', {}, 'en')).toBe('{count} days');

    setActiveLocale('en');
    expect(getActiveLocale()).toBe('en');
    expect(translate('errors.DUPLICATE_BOOK')).toBe(
      'This book is already in your library.',
    );
  });

  it('keeps every English message non-empty where Chinese has text', () => {
    const zhKeys = leafKeys(zhCN);
    expect(leafKeys(en)).toEqual(zhKeys);
    for (const key of zhKeys) {
      const zh = key
        .split('.')
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown>)[part],
          zhCN,
        );
      const english = key
        .split('.')
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown>)[part],
          en,
        );
      expect(Boolean(english), key).toBe(Boolean(zh));
    }
  });

  it('re-renders hook consumers when the preference changes', () => {
    const { result } = renderHook(() => useI18n());
    expect(result.current.t('app.navLibrary')).toBe('书架');

    act(() => {
      useAppStore.getState().setLocale('en');
    });
    expect(result.current.locale).toBe('en');
    expect(result.current.t('app.navLibrary')).toBe('Library');
    expect(result.current.formatNumber(12345)).toBe('12,345');
  });
});
