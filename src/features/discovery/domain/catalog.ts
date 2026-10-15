import { z } from 'zod';

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
}

export interface NovelCatalogue {
  id: string;
  title: string;
  author: string;
  url: string;
  volumes: NovelVolume[];
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
}
