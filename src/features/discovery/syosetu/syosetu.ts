/** A work from the なろう API search. */
export interface SyosetuWork {
  ncode: string;
  title: string;
  author: string;
  story: string;
  episodes: number;
  /** A one-episode short story, whose text is on the work page itself. */
  short: boolean;
  /** Finished (or a short story); otherwise still being serialized. */
  ended: boolean;
  updatedAt: string | null;
}

export interface SyosetuSearchResult {
  total: number;
  works: SyosetuWork[];
}

export interface SyosetuEpisode {
  /** 0 for a short story's single episode. */
  number: number;
  title: string;
}

/**
 * A fetchable unit: a 部 from the table of contents, or a run of at most
 * `VOLUME_EPISODES` episodes. Its id is its first episode number, which stays
 * stable when the author adds episodes or sections later.
 */
export interface SyosetuVolume {
  id: string;
  title: string;
  episodes: SyosetuEpisode[];
}

export interface SyosetuToc {
  ncode: string;
  title: string;
  author: string;
  summary: string;
  short: boolean;
  volumes: SyosetuVolume[];
  /** Table-of-contents pages beyond the read limit were not read. */
  truncated: boolean;
}

export interface SyosetuEpisodeContent {
  title: string;
  /** Illustrations appear as `<img src="image:{index}" />` into `images`. */
  html: string;
  images: string[];
}

export const VOLUME_EPISODES = 100;
export const MAX_TOC_PAGES = 30;

export const ncodePattern = /^n\d{4}[a-z]{1,3}$/;

export function workUrl(ncode: string): string {
  return `https://ncode.syosetu.com/${ncode}/`;
}

export function episodePath(ncode: string, number: number): string {
  return number === 0 ? `/${ncode}/` : `/${ncode}/${String(number)}/`;
}
