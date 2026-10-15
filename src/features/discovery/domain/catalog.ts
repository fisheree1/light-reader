import { z } from 'zod';

import type { ChineseScript } from './chinese-script';
import type { TranslationMethod, VolumeKind } from './edition';

export const sourceSchema = z.enum(['bilinovel', 'linovelib']);
export type NovelSource = z.infer<typeof sourceSchema>;

export const sourceHosts: Record<NovelSource, string> = {
  bilinovel: 'www.bilinovel.com',
  linovelib: 'www.linovelib.com',
};

export const pageSnapshotSchema = z.object({
  url: z.url().max(2048),
  html: z.string().max(2 * 1024 * 1024),
});
export type PageSnapshot = z.infer<typeof pageSnapshotSchema>;

export interface NovelSummary {
  id: string;
  title: string;
  url: string;
}

export interface NovelChapter {
  id: string;
  title: string;
  path: string;
}

export interface NovelVolume {
  id: string;
  title: string;
  chapters: NovelChapter[];
  unavailableChapters: number;
  coverUrl: string | null;
  contentKind: 'novel' | 'other';
  /** Main volume, side story or collection, from the title. */
  kind: VolumeKind;
  /** Explicit edition label such as 文库版 or Web 版; null when not stated. */
  edition: string | null;
  /** Script of the volume and chapter titles; `unknown` without evidence. */
  script: ChineseScript;
}

export interface NovelCatalogue {
  id: string;
  title: string;
  author: string;
  url: string;
  volumes: NovelVolume[];
  /** Translators declared on the catalogue page. */
  translators: string[];
  /** Translation method declared on the catalogue page. */
  translationMethod: TranslationMethod;
}

export type PageRequest =
  | { kind: 'current' }
  | { kind: 'search'; query: string }
  | { kind: 'page'; path: string };

export interface NovelGateway {
  readonly available: boolean;
  readPage(
    source: NovelSource,
    request: PageRequest,
    signal: AbortSignal,
  ): Promise<PageSnapshot>;
  readImage(
    source: NovelSource,
    url: string,
    signal: AbortSignal,
  ): Promise<Uint8Array>;
  openSource(source: NovelSource, path?: string): Promise<void>;
}

export interface AcquisitionProgress {
  stage: 'fetching' | 'images' | 'building' | 'importing';
  completed: number;
  total: number;
}

export interface ParsedChapter {
  title: string;
  html: string;
  images: string[];
  nextPath: string | null;
  translators: string[];
  translationMethod: TranslationMethod;
}
