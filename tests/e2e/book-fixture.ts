/// <reference lib="dom" />

import type { Page } from '@playwright/test';

import { createEpubFixture } from '../../src/test/fixtures/epub-fixture.js';

const testEpub = createEpubFixture({
  title: 'Web 测试 EPUB',
  author: 'LightReader',
  chapters: [
    {
      id: 'one',
      href: 'one.xhtml',
      title: '第一章',
      text: '这是 LightReader 自制的无版权测试内容。',
    },
    {
      id: 'two',
      href: 'two.xhtml',
      title: '第二章',
      text: '目录导航已经到达第二章。',
    },
  ],
});
const testEpubBytes = Array.from(testEpub);

export async function importTestEpub(page: Page): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入电子书' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'web-test.epub',
    mimeType: 'application/epub+zip',
    buffer: Buffer.from(testEpub),
  });
}

export async function hasStoredTestEpub(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const rawBooks = localStorage.getItem('light-reader-web-books');
    if (!rawBooks) return false;
    const books = JSON.parse(rawBooks) as {
      filePath: string;
      title: string;
    }[];
    const book = books.find((item) => item.title === 'Web 测试 EPUB');
    if (!book) return false;

    return new Promise<boolean>((resolve) => {
      const openRequest = indexedDB.open('light-reader-web-files', 1);
      openRequest.addEventListener(
        'error',
        () => {
          resolve(false);
        },
        { once: true },
      );
      openRequest.addEventListener(
        'success',
        () => {
          const database = openRequest.result;
          const getRequest = database
            .transaction('files', 'readonly')
            .objectStore('files')
            .get(book.filePath);
          getRequest.addEventListener(
            'success',
            () => {
              database.close();
              resolve(getRequest.result !== undefined);
            },
            { once: true },
          );
          getRequest.addEventListener(
            'error',
            () => {
              database.close();
              resolve(false);
            },
            { once: true },
          );
        },
        { once: true },
      );
    });
  });
}

export async function storeTestEpubForPaths(
  page: Page,
  filePaths: string[],
): Promise<void> {
  await page.evaluate(
    async ({ bytes, paths }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('light-reader-web-files', 1);
        request.addEventListener(
          'upgradeneeded',
          () => {
            if (!request.result.objectStoreNames.contains('files')) {
              request.result.createObjectStore('files', { keyPath: 'path' });
            }
          },
          { once: true },
        );
        request.addEventListener(
          'success',
          () => {
            resolve(request.result);
          },
          { once: true },
        );
        request.addEventListener(
          'error',
          () => {
            reject(request.error ?? new Error('IndexedDB open failed'));
          },
          { once: true },
        );
      });
      const transaction = database.transaction('files', 'readwrite');
      for (const path of paths) {
        transaction.objectStore('files').put({
          path,
          data: Uint8Array.from(bytes).buffer,
          mediaType: 'application/epub+zip',
        });
      }
      await new Promise<void>((resolve, reject) => {
        transaction.addEventListener(
          'complete',
          () => {
            resolve();
          },
          { once: true },
        );
        transaction.addEventListener(
          'error',
          () => {
            reject(transaction.error ?? new Error('IndexedDB write failed'));
          },
          { once: true },
        );
      });
      database.close();
    },
    { bytes: testEpubBytes, paths: filePaths },
  );
}
