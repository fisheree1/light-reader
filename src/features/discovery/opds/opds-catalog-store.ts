import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { createUuid } from '../../../lib/id';
import { opdsCatalogSchema, type OpdsCatalog } from './opds';

/** Public catalogs offered as one-click additions. */
export const suggestedCatalogs = [
  { title: 'Project Gutenberg', url: 'https://www.gutenberg.org/ebooks.opds/' },
] as const;

const MAX_CATALOGS = 30;

interface OpdsCatalogState {
  catalogs: OpdsCatalog[];
  /** Adds a catalog, or returns null for an invalid or duplicate address. */
  add: (title: string, url: string) => OpdsCatalog | null;
  remove: (id: string) => void;
}

/**
 * The user's catalog list is a preference, like the theme: it lives in local
 * storage rather than the book database and is not part of backups.
 */
export const useOpdsCatalogs = create<OpdsCatalogState>()(
  persist(
    (set, get) => ({
      catalogs: [],
      add: (title, url) => {
        const parsed = opdsCatalogSchema.safeParse({
          id: createUuid(),
          title: title.trim() || url.trim(),
          url: url.trim(),
        });
        if (!parsed.success) return null;
        const { catalogs } = get();
        if (
          catalogs.length >= MAX_CATALOGS ||
          catalogs.some((item) => item.url === parsed.data.url)
        )
          return null;
        set({ catalogs: [...catalogs, parsed.data] });
        return parsed.data;
      },
      remove: (id) => {
        set({ catalogs: get().catalogs.filter((item) => item.id !== id) });
      },
    }),
    {
      name: 'light-reader-opds',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ catalogs }) => ({ catalogs }),
      merge: (persisted, current) => ({
        ...current,
        catalogs: opdsCatalogSchema
          .array()
          .catch([])
          .parse((persisted as { catalogs?: unknown } | null)?.catalogs ?? []),
      }),
    },
  ),
);
