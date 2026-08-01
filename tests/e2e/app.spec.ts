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

  await page.getByRole('button', { name: /预置测试图书/ }).click();
  await expect(page).toHaveURL(/\/reader\/preloaded-book$/);
  await expect(
    page.getByRole('heading', { level: 1, name: '预置测试图书' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '第一章' })).toBeVisible();
  await page.getByRole('button', { name: '第二章' }).click();
  await expect(page.getByRole('button', { name: '下一页' })).toBeEnabled();
  await page.getByRole('link', { name: '返回书架' }).click();
  await expect(page).toHaveURL(/\/library$/);
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

test('persists global reading settings and a per-book override', async ({
  page,
}) => {
  await page.goto('/settings');
  await page.getByLabel('阅读主题').selectOption('sepia');
  await page.getByLabel('字号').fill('22');
  await page.getByRole('button', { name: '保存全局设置' }).click();
  await expect(page.getByText('阅读设置已保存')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('阅读主题')).toHaveValue('sepia');
  await expect(page.getByLabel('字号')).toHaveValue('22');

  await page.goto('/library');
  await page.getByRole('button', { name: '导入 EPUB' }).click();
  await page.getByRole('button', { name: /Web 测试 EPUB/ }).click();
  await expect(page.getByRole('button', { name: '第一章' })).toBeVisible();

  await page.getByRole('button', { name: '阅读设置' }).click();
  await page.getByLabel('为本书使用单独设置').check();
  await page.getByLabel('阅读主题').selectOption('dark');
  await page.getByRole('button', { name: '保存设置' }).click();
  await page.getByRole('button', { name: '阅读设置' }).click();
  await expect(page.getByLabel('为本书使用单独设置')).toBeChecked();
  await expect(page.getByLabel('阅读主题')).toHaveValue('dark');
});

test('creates a highlight with a note and restores both after reopening', async ({
  page,
}) => {
  await page.goto('/library');
  await page.getByRole('button', { name: '导入 EPUB' }).click();
  await page.getByRole('button', { name: /Web 测试 EPUB/ }).click();
  await expect(page.getByRole('button', { name: '第一章' })).toBeVisible();

  await expect.poll(() => page.frames().length).toBeGreaterThan(1);
  const contentFrame = page
    .frames()
    .find((frame) => frame !== page.mainFrame());
  if (!contentFrame) throw new Error('EPUB content frame was not created');
  await contentFrame
    .getByText('这是 LightReader 自制的无版权测试内容。')
    .selectText();

  await page.getByRole('button', { name: '蓝色高亮' }).click();
  await page.getByRole('button', { name: '添加高亮' }).click();
  const annotationCard = page
    .getByText('这是 LightReader 自制的无版权测试内容。', { exact: true })
    .locator('..');
  await expect(annotationCard).toBeVisible();
  await annotationCard.click();

  await page.getByLabel('批注内容').fill('E2E 自制批注');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('已保存')).toBeVisible();
  await page.getByRole('button', { name: '关闭批注' }).click();
  await page.getByRole('link', { name: '返回书架' }).click();

  await page.getByRole('button', { name: /Web 测试 EPUB/ }).click();
  await expect(
    page.getByText('这是 LightReader 自制的无版权测试内容。', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('E2E 自制批注', { exact: true })).toBeVisible();
  const importedReaderUrl = page.url();

  await page
    .getByText('这是 LightReader 自制的无版权测试内容。', { exact: true })
    .locator('..')
    .click();
  await page.getByRole('button', { name: '插入笔记' }).click();
  await expect(page).toHaveURL(/\/notes\?noteId=/);
  await expect(
    page.getByRole('textbox', { name: '笔记标题', exact: true }),
  ).toHaveValue('关于《Web 测试 EPUB》的笔记');
  const quote = page.getByRole('button', {
    name: /返回《Web 测试 EPUB》中的引用/,
  });
  await expect(quote).toBeVisible();

  const editor = page.getByRole('textbox', { name: '笔记正文' });
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type('E2E 独立笔记正文');
  await expect(page.getByText('已保存')).toBeVisible();

  await page.reload();
  await expect(
    page.getByText('E2E 独立笔记正文', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: /返回《Web 测试 EPUB》中的引用/ })
    .click();
  await expect(page).toHaveURL(importedReaderUrl);
  await expect(page.getByRole('button', { name: '第一章' })).toBeVisible();
});
