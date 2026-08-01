import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark';

interface AppState {
  isNavigationExpanded: boolean;
  setTheme: (theme: Theme) => void;
  theme: Theme;
  toggleNavigation: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      isNavigationExpanded: true,
      theme: 'light',
      setTheme: (theme) => set({ theme }),
      toggleNavigation: () =>
        set((state) => ({ isNavigationExpanded: !state.isNavigationExpanded })),
    }),
    {
      name: 'light-reader-app',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ isNavigationExpanded, theme }) => ({
        isNavigationExpanded,
        theme,
      }),
    },
  ),
);
