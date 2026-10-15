import { zhCN, type Messages } from './messages/zh-CN';

export const supportedLocales = ['zh-CN', 'en'] as const;
export type AppLocale = (typeof supportedLocales)[number];
export type LocalePreference = AppLocale | 'system';

// Chinese ships with the app shell; other catalogs load on demand.
const catalogs: Partial<Record<AppLocale, Messages>> = { 'zh-CN': zhCN };

export function isLocaleLoaded(locale: AppLocale): boolean {
  return catalogs[locale] !== undefined;
}

/** Loads a locale's catalog; resolves immediately when already loaded. */
export async function loadLocale(locale: AppLocale): Promise<void> {
  if (isLocaleLoaded(locale)) return;
  if (locale === 'en') {
    catalogs.en = (await import('./messages/en')).en;
  }
}

type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

/** Dot-separated path to one message, e.g. `library.importButton`. */
export type MessageKey = Leaves<Messages>;
export type MessageParams = Record<string, string | number>;

/** Picks the first supported language from the browser preferences. */
export function detectLocale(
  languages: readonly string[] = typeof navigator === 'undefined'
    ? []
    : navigator.languages,
): AppLocale {
  for (const language of languages) {
    const normalized = language.toLowerCase();
    if (normalized.startsWith('zh')) return 'zh-CN';
    if (normalized.startsWith('en')) return 'en';
  }
  return 'zh-CN';
}

export function resolveLocale(preference: LocalePreference): AppLocale {
  return preference === 'system' ? detectLocale() : preference;
}

let activeLocale: AppLocale = 'zh-CN';

/** Sets the locale used by `translate` outside React (errors, services). */
export function setActiveLocale(locale: AppLocale): void {
  activeLocale = locale;
}

export function getActiveLocale(): AppLocale {
  return activeLocale;
}

function lookup(catalog: Messages, key: string): string | undefined {
  let node: unknown = catalog;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Resolves a message and fills `{name}` placeholders. */
export function translate(
  key: MessageKey,
  params?: MessageParams,
  locale: AppLocale = activeLocale,
): string {
  const catalog = catalogs[locale] ?? zhCN;
  const template = lookup(catalog, key) ?? lookup(zhCN, key) ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** BCP 47 tag for `Intl` formatting in the given locale. */
export function intlLocale(locale: AppLocale = activeLocale): string {
  return locale === 'en' ? 'en-US' : 'zh-CN';
}
