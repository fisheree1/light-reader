import { create } from 'zustand';

import { translate } from '../../../i18n/i18n';
import {
  EpubValidationError,
  type AcquisitionReport,
} from '../domain/acquisition-report';
import type { AcquisitionProgress } from '../domain/catalog';
import {
  discoveryErrorMessage,
  isSourceRefusal,
} from '../domain/discovery-error';

export type DownloadStatus =
  'queued' | 'running' | 'created' | 'duplicate' | 'failed' | 'cancelled';

/** One volume to fetch, as the download list shows it. */
export interface DownloadJob {
  id: string;
  /** Which panel and work it belongs to, such as `novel:bilinovel:1`. */
  group: string;
  volumeId: string;
  title: string;
  status: DownloadStatus;
  progress: AcquisitionProgress | null;
  bookId?: string;
  message?: string;
  missingImages?: number;
  report?: AcquisitionReport;
}

export interface DownloadResult {
  status: 'created' | 'duplicate';
  book: { id: string };
  missingImages?: number;
  report?: AcquisitionReport;
}

export interface DownloadTask {
  group: string;
  volumeId: string;
  title: string;
  run: (
    signal: AbortSignal,
    onProgress: (progress: AcquisitionProgress) => void,
  ) => Promise<DownloadResult>;
}

interface DownloadState {
  jobs: DownloadJob[];
}

/**
 * Downloads in this session, in order. UI state only: it lives in memory, so
 * closing the app ends the queue (a retry reuses what was already fetched).
 */
export const useDownloads = create<DownloadState>(() => ({ jobs: [] }));

const tasks = new Map<string, DownloadTask>();
let running: { id: string; controller: AbortController } | null = null;
let sequence = 0;

export function isActive(job: DownloadJob): boolean {
  return job.status === 'queued' || job.status === 'running';
}

function update(id: string, change: Partial<DownloadJob>) {
  useDownloads.setState((state) => ({
    jobs: state.jobs.map((job) =>
      job.id === id ? { ...job, ...change } : job,
    ),
  }));
}

function cancelQueued(message?: string) {
  useDownloads.setState((state) => ({
    jobs: state.jobs.map((job) =>
      job.status === 'queued' ? { ...job, status: 'cancelled', message } : job,
    ),
  }));
  for (const job of useDownloads.getState().jobs)
    if (job.status === 'cancelled') tasks.delete(job.id);
}

async function runNext(): Promise<void> {
  if (running) return;
  const next = useDownloads
    .getState()
    .jobs.find((job) => job.status === 'queued');
  const task = next ? tasks.get(next.id) : undefined;
  if (!next || !task) return;
  const controller = new AbortController();
  running = { id: next.id, controller };
  update(next.id, { status: 'running', progress: null });
  try {
    const result = await task.run(controller.signal, (progress) => {
      update(next.id, { progress });
    });
    update(next.id, {
      status: result.status,
      progress: null,
      bookId: result.book.id,
      missingImages: result.missingImages,
      report: result.report,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      update(next.id, { status: 'cancelled', progress: null });
    } else {
      update(next.id, {
        status: 'failed',
        progress: null,
        message: discoveryErrorMessage(error),
        report: error instanceof EpubValidationError ? error.report : undefined,
      });
      // The site refused or throttled us: do not start the next volume.
      if (isSourceRefusal(error))
        cancelQueued(translate('discovery.stoppedAfterBlock'));
    }
  } finally {
    tasks.delete(next.id);
    running = null;
  }
  await runNext();
}

/** Adds volumes to the end of the queue; they run one at a time. */
export function enqueueDownloads(items: readonly DownloadTask[]): void {
  const added: DownloadJob[] = [];
  for (const item of items) {
    const id = `download-${String((sequence += 1))}`;
    tasks.set(id, item);
    added.push({
      id,
      group: item.group,
      volumeId: item.volumeId,
      title: item.title,
      status: 'queued',
      progress: null,
    });
  }
  // Fetching a volume again replaces its finished entry.
  const replaced = (job: DownloadJob) =>
    !isActive(job) &&
    added.some(
      (item) => item.group === job.group && item.volumeId === job.volumeId,
    );
  useDownloads.setState((state) => ({
    jobs: [...state.jobs.filter((job) => !replaced(job)), ...added],
  }));
  void runNext();
}

/** Cancels one download: stops it if running, or drops it from the queue. */
export function cancelDownload(id: string): void {
  if (running?.id === id) {
    running.controller.abort();
    return;
  }
  const job = useDownloads.getState().jobs.find((item) => item.id === id);
  if (job?.status !== 'queued') return;
  tasks.delete(id);
  update(id, { status: 'cancelled' });
}

/** Removes finished downloads of the groups starting with `prefix`. */
export function clearFinishedDownloads(prefix: string): void {
  useDownloads.setState((state) => ({
    jobs: state.jobs.filter(
      (job) => isActive(job) || !job.group.startsWith(prefix),
    ),
  }));
}

/** For tests: stops everything and empties the list. */
export function resetDownloads(): void {
  running?.controller.abort();
  running = null;
  tasks.clear();
  useDownloads.setState({ jobs: [] });
}
