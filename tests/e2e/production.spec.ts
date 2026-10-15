import { expect, test, type Page } from '@playwright/test';

import {
  createCbzFixture,
  createFb2Fixture,
} from '../../src/test/fixtures/foliate-fixtures.js';

// Runs against the production build (`vite build` + `vite preview`). Foliate
// loads the MOBI, FB2 and CBZ parsers with dynamic imports, which the dev
// server resolves differently from the bundled app.

async function importBook(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入电子书' }).click();
  await (await chooserPromise).setFiles(file);
  await expect(page.getByRole('status')).toContainText('新增 1 本');
}

async function expectFrameText(page: Page, text: string) {
  await expect
    .poll(async () => {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
          if (await frame.getByText(text, { exact: true }).isVisible()) {
            return true;
          }
        } catch {
          // Foliate replaces frames while it renders; keep polling.
        }
      }
      return false;
    })
    .toBe(true);
}

test('imports and reads an FB2 book in the production build', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/library');
  await importBook(page, {
    name: 'fixture.fb2',
    mimeType: 'application/x-fictionbook+xml',
    buffer: Buffer.from(createFb2Fixture()),
  });

  await page.getByRole('button', { name: '打开《FB2 测试书》' }).click();
  await expect(page.getByRole('region', { name: 'FB2 正文' })).toBeVisible();
  await expectFrameText(page, '第一章的正文内容。');
  expect(pageErrors).toEqual([]);
});

test('imports and opens a CBZ comic in the production build', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/library');
  await importBook(page, {
    name: '测试漫画.cbz',
    mimeType: 'application/vnd.comicbook+zip',
    buffer: Buffer.from(createCbzFixture()),
  });

  await page.getByRole('button', { name: '打开《测试漫画》' }).click();
  await expect(page.getByRole('region', { name: 'CBZ 正文' })).toBeVisible();
  await expect(page.getByText('无法打开图书')).toHaveCount(0);
  await expect
    .poll(() => page.frames().some((frame) => frame.url().startsWith('blob:')))
    .toBe(true);
  expect(pageErrors).toEqual([]);
});
