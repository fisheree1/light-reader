import { seriesTitleFromVolume } from '../../library/domain/book-series';
import type { LibraryBook } from '../../library/domain/library';
import type { NovelSource } from './catalog';

/** A shelf book that was fetched from a light-novel source. */
export interface OwnedVolume {
  bookId: string;
  source: NovelSource;
  novelId: string;
  volumeId: string;
  seriesTitle: string;
  addedAt: number;
  lastReadAt: number | null;
}

/** A source work with at least one volume on the shelf. */
export interface FollowedSeries {
  source: NovelSource;
  novelId: string;
  title: string;
  volumes: number;
  /** Latest of added or read, for ordering the list. */
  activeAt: number;
}

export function volumeKey(
  source: NovelSource,
  novelId: string,
  volumeId: string,
): string {
  return `${source}:${novelId}:${volumeId}`;
}

export function ownedVolumes(books: readonly LibraryBook[]): OwnedVolume[] {
  return books.flatMap((book) => {
    const origin = book.metadata.origin;
    if (!origin) return [];
    return [
      {
        bookId: book.id,
        source: origin.source,
        novelId: origin.novelId,
        volumeId: origin.volumeId,
        seriesTitle:
          book.metadata.series?.title ?? seriesTitleFromVolume(book.title),
        addedAt: book.createdAt,
        lastReadAt: book.lastReadAt,
      },
    ];
  });
}

/**
 * Owned volumes by source volume. A volume fetched again after the source
 * changed is a second book; the newest one is the one to open.
 */
export function ownedVolumeIndex(
  owned: readonly OwnedVolume[],
): Map<string, OwnedVolume> {
  const index = new Map<string, OwnedVolume>();
  for (const volume of owned) {
    const key = volumeKey(volume.source, volume.novelId, volume.volumeId);
    const current = index.get(key);
    if (!current || volume.addedAt > current.addedAt) index.set(key, volume);
  }
  return index;
}

/** Works to check for new volumes, most recently active first. */
export function followedSeries(
  owned: readonly OwnedVolume[],
): FollowedSeries[] {
  const works = new Map<string, FollowedSeries & { volumeIds: Set<string> }>();
  for (const volume of owned) {
    const key = `${volume.source}:${volume.novelId}`;
    const activeAt = Math.max(volume.addedAt, volume.lastReadAt ?? 0);
    const work = works.get(key);
    if (!work) {
      works.set(key, {
        source: volume.source,
        novelId: volume.novelId,
        title: volume.seriesTitle,
        volumes: 1,
        activeAt,
        volumeIds: new Set([volume.volumeId]),
      });
      continue;
    }
    work.volumeIds.add(volume.volumeId);
    work.volumes = work.volumeIds.size;
    work.activeAt = Math.max(work.activeAt, activeAt);
  }
  return [...works.values()]
    .sort((left, right) => right.activeAt - left.activeAt)
    .map((work) => ({
      source: work.source,
      novelId: work.novelId,
      title: work.title,
      volumes: work.volumes,
      activeAt: work.activeAt,
    }));
}
