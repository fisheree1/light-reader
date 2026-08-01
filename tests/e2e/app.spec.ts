import { expect, test } from '@playwright/test';

test('starts and navigates between the scaffold pages', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveURL(/\/library$/);
  await expect(
    page.getByRole('heading', { level: 1, name: '书架' }),
  ).toBeVisible();

  await page.getByRole('link', { name: '笔记' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: '笔记' }),
  ).toBeVisible();

  await page.getByRole('link', { name: '设置' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: '设置' }),
  ).toBeVisible();
});

test('switches theme', async ({ page }) => {
  await page.goto('/library');
  await page.getByRole('button', { name: '切换到深色主题' }).click();

  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('shows a persisted book from preloaded Web data', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'light-reader-web-books',
      JSON.stringify([
        {
          id: 'preloaded-book',
          title: '预置测试图书',
          author: null,
          format: 'epub',
          filePath: 'light-reader/books/preloaded-book/book.epub',
          fileHash: 'c'.repeat(64),
          coverPath: null,
          metadata: {
            title: '预置测试图书',
            creators: [],
            language: 'zh-CN',
            publisher: null,
            description: null,
            identifier: null,
          },
          fileSize: 256,
          createdAt: 10,
          updatedAt: 10,
        },
      ]),
    );
  });

  await page.goto('/library');

  await expect(
    page.getByRole('button', { name: /预置测试图书/ }),
  ).toBeVisible();
  await expect(page.getByText('未知作者')).toBeVisible();
});

test('verifies the import interaction through the Web mock adapter', async ({
  page,
}) => {
  await page.goto('/library');
  await expect(
    page.getByRole('heading', { name: '书架还是空的' }),
  ).toBeVisible();

  await page.getByRole('button', { name: '导入 EPUB' }).click();

  await expect(page.getByRole('status')).toContainText('已导入书架');
  await expect(
    page.getByRole('button', { name: /Web 测试 EPUB/ }),
  ).toBeVisible();

  await page.getByRole('button', { name: '导入 EPUB' }).click();
  await expect(page.getByRole('status')).toContainText('已经在书架');
});
