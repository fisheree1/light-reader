import { waitFor } from '@testing-library/react';

import { DiscoveryError } from '../domain/discovery-error';
import {
  cancelDownload,
  clearFinishedDownloads,
  enqueueDownloads,
  resetDownloads,
  useDownloads,
  type DownloadTask,
} from './download-queue';

function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function task(
  volumeId: string,
  run: DownloadTask['run'],
  group = 'novel:bilinovel:1',
): DownloadTask {
  return { group, volumeId, title: `第${volumeId}卷`, run };
}

const statuses = () =>
  useDownloads.getState().jobs.map((job) => [job.volumeId, job.status]);

describe('download queue', () => {
  beforeEach(() => {
    resetDownloads();
  });

  it('runs one volume at a time, in order, reporting progress', async () => {
    const first = deferred();
    const order: string[] = [];
    enqueueDownloads([
      task('1', async (_signal, onProgress) => {
        order.push('1');
        onProgress({ stage: 'fetching', completed: 1, total: 4 });
        await first.promise;
        return { status: 'created', book: { id: 'b1' } };
      }),
      task('2', () => {
        order.push('2');
        return Promise.resolve({ status: 'duplicate', book: { id: 'b2' } });
      }),
    ]);
    await waitFor(() => {
      expect(useDownloads.getState().jobs[0]?.progress).toEqual({
        stage: 'fetching',
        completed: 1,
        total: 4,
      });
    });
    expect(statuses()).toEqual([
      ['1', 'running'],
      ['2', 'queued'],
    ]);
    first.resolve();
    await waitFor(() => {
      expect(statuses()).toEqual([
        ['1', 'created'],
        ['2', 'duplicate'],
      ]);
    });
    expect(order).toEqual(['1', '2']);
    expect(useDownloads.getState().jobs[0]?.bookId).toBe('b1');
  });

  it('cancels a queued volume or the running one', async () => {
    let seen: AbortSignal | undefined;
    enqueueDownloads([
      task(
        '1',
        (signal) =>
          new Promise((_resolve, reject) => {
            seen = signal;
            signal.addEventListener('abort', () => {
              reject(new DOMException('Cancelled', 'AbortError'));
            });
          }),
      ),
      task('2', () => Promise.reject(new Error('never runs'))),
      task('3', () =>
        Promise.resolve({ status: 'created', book: { id: 'b3' } }),
      ),
    ]);
    await waitFor(() => {
      expect(seen).toBeDefined();
    });
    const [running, queued] = useDownloads.getState().jobs;
    cancelDownload(queued.id);
    cancelDownload(running.id);
    await waitFor(() => {
      expect(statuses()).toEqual([
        ['1', 'cancelled'],
        ['2', 'cancelled'],
        ['3', 'created'],
      ]);
    });
  });

  it('stops the rest after a refusal and keeps going after other failures', async () => {
    enqueueDownloads([
      task('1', () => Promise.reject(new DiscoveryError('SOURCE_INCOMPLETE'))),
      task('2', () =>
        Promise.reject(new DiscoveryError('SOURCE_RATE_LIMITED')),
      ),
      task('3', () =>
        Promise.resolve({ status: 'created', book: { id: 'b3' } }),
      ),
    ]);
    await waitFor(() => {
      expect(statuses()).toEqual([
        ['1', 'failed'],
        ['2', 'failed'],
        ['3', 'cancelled'],
      ]);
    });
    expect(useDownloads.getState().jobs[2]?.message).toBe(
      '书源拒绝或限制了访问，剩余卷册已停止获取。',
    );
  });

  it('clears finished downloads of one panel only', async () => {
    enqueueDownloads([
      task('1', () =>
        Promise.resolve({ status: 'created', book: { id: 'b1' } }),
      ),
      task(
        'n',
        () => Promise.resolve({ status: 'created', book: { id: 'bn' } }),
        'syosetu:n0001aa',
      ),
    ]);
    await waitFor(() => {
      expect(statuses()).toEqual([
        ['1', 'created'],
        ['n', 'created'],
      ]);
    });
    clearFinishedDownloads('novel:');
    expect(statuses()).toEqual([['n', 'created']]);
  });

  it('replaces a finished entry when the same volume is fetched again', async () => {
    const done = () =>
      Promise.resolve({ status: 'created' as const, book: { id: 'b1' } });
    enqueueDownloads([task('1', done)]);
    await waitFor(() => {
      expect(statuses()).toEqual([['1', 'created']]);
    });
    enqueueDownloads([
      task('1', () =>
        Promise.resolve({ status: 'duplicate', book: { id: 'b1' } }),
      ),
    ]);
    await waitFor(() => {
      expect(statuses()).toEqual([['1', 'duplicate']]);
    });
  });
});
