import { create } from 'zustand';

import {
  defaultReaderSettings,
  resolveReaderSettings,
  type ReaderDisplaySettings,
  type ReaderSettingsOverride,
} from '../features/reader/domain/reader-settings';

interface ReaderSettingsState {
  bookId: string | null;
  bookOverride: ReaderSettingsOverride | null;
  globalSettings: ReaderDisplaySettings;
  hydrate: (
    bookId: string,
    globalSettings: ReaderDisplaySettings,
    bookOverride: ReaderSettingsOverride | null,
  ) => void;
  reset: () => void;
  setBookOverride: (settings: ReaderSettingsOverride | null) => void;
  setGlobalSettings: (settings: ReaderDisplaySettings) => void;
}

export const useReaderSettingsStore = create<ReaderSettingsState>((set) => ({
  bookId: null,
  bookOverride: null,
  globalSettings: defaultReaderSettings,
  hydrate: (bookId, globalSettings, bookOverride) => {
    set({ bookId, globalSettings, bookOverride });
  },
  reset: () => {
    set({
      bookId: null,
      bookOverride: null,
      globalSettings: defaultReaderSettings,
    });
  },
  setBookOverride: (bookOverride) => {
    set({ bookOverride });
  },
  setGlobalSettings: (globalSettings) => {
    set({ globalSettings });
  },
}));

export function selectEffectiveReaderSettings(
  state: ReaderSettingsState,
): ReaderDisplaySettings {
  return resolveReaderSettings(state.globalSettings, state.bookOverride);
}
