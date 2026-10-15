import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { LocalePreference } from '../i18n/i18n';

export type Theme = 'light' | 'dark';

interface AppState {
  isNavigationExpanded: boolean;
  /** Interface language; `system` follows the browser/OS preference. */
  locale: LocalePreference;
  setLocale: (locale: LocalePreference) => void;
  setTheme: (theme: Theme) => void;
  theme: Theme;
  toggleNavigation: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      isNavigationExpanded: true,
      locale: 'system',
      setLocale: (locale) => set({ locale }),
      theme: 'light',
      setTheme: (theme) => set({ theme }),
      toggleNavigation: () =>
        set((state) => ({ isNavigationExpanded: !state.isNavigationExpanded })),
    }),
    {
      name: 'light-reader-app',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ isNavigationExpanded, locale, theme }) => ({
        isNavigationExpanded,
        locale,
        theme,
      }),
    },
  ),
);
