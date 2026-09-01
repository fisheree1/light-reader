import { expect, test, type Frame, type Page } from '@playwright/test';

interface BrowserDiagnostics {
  pageErrors: string[];
  routerWarnings: string[];
}

const diagnosticsByPage = new WeakMap<Page, BrowserDiagnostics>();

test.beforeEach(({ page }) => {
  const diagnostics: BrowserDiagnostics = {
    pageErrors: [],
    routerWarnings: [],
  };
  diagnosticsByPage.set(page, diagnostics);
  page.on('pageerror', (error) => {
    diagnostics.pageErrors.push(error.message);
  });
  page.on('console', (message) => {
    if (
      message.type() === 'warning' &&
      message.text().includes('HydrateFallback')
    ) {
      diagnostics.routerWarnings.push(message.text());
    }
  });
});

test.afterEach(({ page }) => {
  const diagnostics = diagnosticsByPage.get(page);
  expect(diagnostics?.pageErrors ?? []).toEqual([]);
  expect(diagnostics?.routerWarnings ?? []).toEqual([]);
});

async function findContentFrame(page: Page, text: string): Promise<Frame> {
  let contentFrame: Frame | undefined;
  await expect
    .poll(async () => {
      contentFrame = undefined;
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
          if (await frame.getByText(text, { exact: true }).isVisible()) {
            contentFrame = frame;
            break;
          }
        } catch {
          // Foliate replaces frames during navigation; retry discovery.
        }
      }
      return contentFrame !== undefined;
    })
    .toBe(true);
  if (!contentFrame) throw new Error('EPUB content frame was not created');
  return contentFrame;
}

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

  await page.getByRole('link', { name: '搜索' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: '搜索' }),
  ).toBeVisible();

  await page.getByRole('link', { name: '设置' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: '设置' }),
  ).toBeVisible();
});

test('searches notes, highlights, and EPUB content entirely in Web mocks', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const book = {
      id: 'search-book',
      title: '本地搜索测试书',
      author: 'LightReader',
      format: 'epub',
      filePath: 'light-reader/books/search-book/book.epub',
      fileHash: 'e'.repeat(64),
      coverPath: null,
      metadata: {
        title: '本地搜索测试书',
        creators: ['LightReader'],
        language: 'zh-CN',
        publisher: null,
        description: null,
        identifier: null,
      },
      fileSize: 256,
      createdAt: 1,
      updatedAt: 1,
    };
    localStorage.setItem('light-reader-web-books', JSON.stringify([book]));
    localStorage.setItem(
      'light-reader-web-notes',
      JSON.stringify([
        {
          id: 'search-note',
          title: '中文搜索笔记',
          document: {
            schemaVersion: 1,
            content: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: '只保存在本机的内容' }],
                },
              ],
            },
          },
          plainText: '只保存在本机的内容',
          documentRecovered: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );
    localStorage.setItem(
      'light-reader-web-annotations',
      JSON.stringify([
        {
          id: 'search-annotation',
          bookId: 'search-book',
          text: 'important local highlight',
          textBefore: null,
          textAfter: null,
          chapterHref: 'one.xhtml',
          locator: {
            version: 1,
            format: 'epub',
            chapterHref: 'one.xhtml',
            cfi: 'epubcfi(/6/2!/4/2)',
          },
          color: 'yellow',
          noteText: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );
  });

  await page.goto('/search');
  const input = page.getByRole('searchbox', { name: '搜索本地内容' });

  await input.fill('中文搜索');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByText('中文搜索笔记', { exact: true })).toBeVisible();

  await input.fill('local highlight');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(
    page.getByText('important local highlight', { exact: true }),
  ).toBeVisible();

  await input.fill('无版权');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(
    page.getByText(/LightReader 自制的无版权测试内容/),
  ).toBeVisible();
  await page.getByRole('button', { name: /第一章/ }).click();
  await expect(page).toHaveURL(/\/reader\/search-book$/);
  await expect(page.getByRole('button', { name: '第一章' })).toBeVisible();
});

test('switches theme', async ({ page }) => {
  await page.goto('/library');
  await page.getByRole('button', { name: '切换到深色主题' }).click();

  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('shows the desktop-only backup boundary in Web settings', async ({
  page,
}) => {
  await page.goto('/settings');

  await expect(
    page.getByRole('heading', { name: '数据导出与备份' }),
  ).toBeVisible();
  await expect(
    page.getByText(/数据库备份仅在 Tauri 桌面应用中可用/),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '导出备份' })).toHaveCount(0);
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
    page.getByRole('button', { name: '打开《预置测试图书》' }),
  ).toBeVisible();
  await expect(page.getByText('未知作者')).toBeVisible();

  await page.getByRole('button', { name: '打开《预置测试图书》' }).click();
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
    page.getByRole('button', { name: '打开《Web 测试 EPUB》' }),
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
  await page.getByRole('button', { name: '打开《Web 测试 EPUB》' }).click();
  await expect(page.getByRole('button', { name: '第一章' })).toBeVisible();

  await page.getByRole('button', { name: '阅读设置' }).click();
  await page.getByLabel('为本书使用单独设置').check();
  await page.getByLabel('阅读主题').selectOption('dark');
  await page.getByRole('button', { name: '保存设置' }).click();
  await page.getByRole('button', { name: '阅读设置' }).click();
  await expect(page.getByLabel('为本书使用单独设置')).toBeChecked();
  await expect(page.getByLabel('阅读主题')).toHaveValue('dark');
});

test('completes the release user loop through the real Foliate Web engine', async ({
  page,
}) => {
  await page.goto('/library');
  await page.getByRole('button', { name: '导入 EPUB' }).click();
  await page.getByRole('button', { name: '打开《Web 测试 EPUB》' }).click();
  await expect(page.getByRole('button', { name: '第一章' })).toBeVisible();

  await page.getByRole('button', { name: '阅读设置' }).click();
  await page.getByLabel('为本书使用单独设置').check();
  await page.getByLabel('阅读主题').selectOption('dark');
  await page.getByRole('button', { name: '保存设置' }).click();
  await page.getByRole('button', { name: '第二章' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = localStorage.getItem('light-reader-reader-settings');
        if (!value) return 0;
        const parsed = JSON.parse(value) as {
          readingStates?: Record<string, unknown>;
        };
        return Object.keys(parsed.readingStates ?? {}).length;
      }),
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: '第一章' }).click();

  const contentFrame = await findContentFrame(
    page,
    '这是 LightReader 自制的无版权测试内容。',
  );
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

  await page.getByRole('button', { name: '打开《Web 测试 EPUB》' }).click();
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

  await page.getByRole('link', { name: '返回书架' }).click();
  await page.reload();
  await expect(
    page.getByRole('button', { name: '打开《Web 测试 EPUB》' }),
  ).toBeVisible();
  await page.getByRole('link', { name: '搜索' }).click();
  const search = page.getByRole('searchbox', { name: '搜索本地内容' });
  await search.fill('E2E 独立笔记正文');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByText('E2E 独立笔记正文')).toBeVisible();
  await search.fill('LightReader 自制的无版权测试内容');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(
    page.getByText('这是 LightReader 自制的无版权测试内容。', {
      exact: true,
    }),
  ).toBeVisible();
});

test('manages favorites, tags, sorting, and protected deletion locally', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const createBook = (
      id: string,
      title: string,
      createdAt: number,
      fileHash: string,
    ) => ({
      id,
      title,
      author: null,
      format: 'epub',
      filePath: `light-reader/books/${id}/book.epub`,
      fileHash,
      coverPath: null,
      metadata: {
        title,
        creators: [],
        language: 'zh-CN',
        publisher: null,
        description: null,
        identifier: null,
      },
      fileSize: 128,
      createdAt,
      updatedAt: createdAt,
    });
    localStorage.setItem(
      'light-reader-web-books',
      JSON.stringify([
        createBook('book-z', 'Zulu', 20, 'b'.repeat(64)),
        createBook('book-a', 'Alpha', 10, 'a'.repeat(64)),
      ]),
    );
    localStorage.setItem(
      'light-reader-web-notes',
      JSON.stringify([
        {
          id: 'protected-note',
          title: '保留引用',
          document: {
            schemaVersion: 1,
            content: {
              type: 'doc',
              content: [
                {
                  type: 'bookQuote',
                  attrs: {
                    bookId: 'book-z',
                    annotationId: 'annotation-z',
                    quote: '离线引用快照',
                    chapter: '第一章',
                    locator: {
                      version: 1,
                      format: 'epub',
                      chapterHref: 'one.xhtml',
                      cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:4)',
                    },
                  },
                },
              ],
            },
          },
          plainText: '离线引用快照',
          documentRecovered: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );
  });

  await page.goto('/library');
  await page.getByLabel('书架排序').selectOption('title');
  const openButtons = page
    .getByRole('region', { name: '书籍' })
    .getByRole('button', { name: /^打开/ });
  await expect(openButtons).toHaveCount(2);
  await expect(openButtons.nth(0)).toHaveAccessibleName('打开《Alpha》');
  await expect(openButtons.nth(1)).toHaveAccessibleName('打开《Zulu》');

  await page.getByRole('button', { name: '收藏《Zulu》' }).click();
  await expect(
    page.getByRole('button', { name: '取消收藏《Zulu》' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '管理《Zulu》' }).click();
  await page.getByLabel('标签').fill('技术, 待读');
  await page.getByRole('button', { name: '保存标签' }).click();
  await page.getByRole('button', { name: '关闭书籍管理' }).click();
  await expect(page.getByRole('status')).toContainText('标签已保存');

  await page.getByRole('searchbox', { name: '搜索书架' }).fill('技术');
  await expect(
    page.getByRole('button', { name: '打开《Zulu》' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '打开《Alpha》' })).toHaveCount(
    0,
  );
  await page.getByRole('searchbox', { name: '搜索书架' }).clear();

  await page.getByRole('button', { name: '管理《Zulu》' }).click();
  await page.getByRole('button', { name: /删除文件但保留笔记引用/ }).click();
  await expect(
    page.getByRole('heading', { name: '确认删除《Zulu》？' }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem('light-reader-web-books')?.includes('book-z'),
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByRole('status')).toContainText('笔记引用快照已保留');
  await expect(page.getByRole('button', { name: '打开《Zulu》' })).toHaveCount(
    0,
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage
          .getItem('light-reader-web-notes')
          ?.includes('离线引用快照'),
      ),
    )
    .toBe(true);
});
