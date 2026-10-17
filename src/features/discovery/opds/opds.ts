import { z } from 'zod';

import type { BookFormat } from '../../library/domain/book';

/** A catalog the user added. Only its URL decides what the app may reach. */
export const opdsCatalogSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().trim().min(1).max(100),
  url: z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .refine((value) => {
      // Refinements still run after a failed format check.
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return !url.username && !url.password;
    }, 'Credentials in the address are not supported.'),
});

export type OpdsCatalog = z.infer<typeof opdsCatalogSchema>;

export interface OpdsAcquisition {
  url: string;
  /** The media type without parameters, such as `application/epub+zip`. */
  type: string;
  format: BookFormat;
}

export interface OpdsEntry {
  id: string;
  title: string;
  authors: string[];
  summary: string | null;
  /** A thumbnail when the feed offers one, else the full cover. */
  coverUrl: string | null;
  acquisitions: OpdsAcquisition[];
  /** A sub-catalog for navigation entries. */
  navigationUrl: string | null;
}

export type OpdsSearch =
  { kind: 'template'; template: string } | { kind: 'description'; url: string };

export interface OpdsFeed {
  url: string;
  title: string;
  entries: OpdsEntry[];
  next: string | null;
  previous: string | null;
  start: string | null;
  search: OpdsSearch | null;
}

/** Media types the importer can read, in order of preference. */
export const opdsFormats: readonly (readonly [
  BookFormat,
  readonly string[],
])[] = [
  ['epub', ['application/epub+zip']],
  [
    'azw3',
    [
      'application/vnd.amazon.mobi8-ebook',
      'application/x-mobi8-ebook',
      'application/vnd.amazon.ebook',
    ],
  ],
  ['mobi', ['application/x-mobipocket-ebook', 'application/x-mobi']],
  ['fb2', ['application/x-fictionbook+xml', 'text/fb2+xml']],
  ['pdf', ['application/pdf']],
  ['cbz', ['application/vnd.comicbook+zip', 'application/x-cbz']],
];

export function formatForType(type: string): BookFormat | null {
  const base = type.split(';')[0]?.trim().toLowerCase() ?? '';
  return opdsFormats.find(([, types]) => types.includes(base))?.[0] ?? null;
}

/** The acquisition to download: the most preferred readable format. */
export function preferredAcquisition(
  entry: Pick<OpdsEntry, 'acquisitions'>,
): OpdsAcquisition | null {
  for (const [format] of opdsFormats) {
    const match = entry.acquisitions.find((item) => item.format === format);
    if (match) return match;
  }
  return null;
}
