import { test, expect, type Page } from '@playwright/test';

async function expectChapterText(page: Page, text: string) {
  await expect
    .poll(async () => {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        if (
          await frame
            .getByText(text, { exact: true })
            .isVisible()
            .catch(() => false)
        )
          return true;
      }
      return false;
    })
    .toBe(true);
}

test('searches, selects a complete translated volume, imports it and reopens offline', async ({
  page,
  context,
}) => {
  await page.goto('/discover');
  await expect(
    page.getByRole('heading', { name: '在线找轻小说', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('searchbox', { name: '书名、别名或作者' })
    .fill('测试轻小说');
  await page.getByRole('button', { name: '搜索书源' }).click();
  await page.getByRole('button', { name: '查看卷册' }).click();
  await expect(
    page.getByRole('checkbox', { name: /测试轻小说 第二卷/ }),
  ).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: /画集/ })).toBeDisabled();
  await page.getByRole('checkbox', { name: /测试轻小说 第一卷/ }).check();
  await page.getByRole('button', { name: '获取所选 1 卷' }).click();
  await expect(page.getByText('已加入书架', { exact: true })).toBeVisible();
  // Reacquisition goes through the same importer and returns the original book.
  await page.getByRole('checkbox', { name: /测试轻小说 第一卷/ }).check();
  await page.getByRole('button', { name: '获取所选 1 卷' }).click();
  await expect(page.getByText('已在书架', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始阅读' }).click();
  await expect(page).toHaveURL(/\/reader\//);
  await expect(
    page.getByRole('button', { name: /目录/ }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: '序章', exact: true }).click();
  await expectChapterText(page, '这是一段为自动测试创作的中文译文。');
  await page.getByRole('button', { name: '插图与注音', exact: true }).click();
  await expect
    .poll(async () => {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        const image = frame.getByAltText('测试插图');
        if (await image.isVisible().catch(() => false)) {
          return image.evaluate(
            (node: HTMLImageElement) =>
              node.complete &&
              node.naturalWidth > 0 &&
              node.src.startsWith('blob:'),
          );
        }
      }
      return false;
    })
    .toBe(true);
  await page.getByRole('button', { name: '序章', exact: true }).click();
  await expectChapterText(page, '这是一段为自动测试创作的中文译文。');
  await page.getByRole('link', { name: '返回书架' }).click();
  await expect(
    page.getByText('测试轻小说 第一卷', { exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await page
    .getByRole('button', { name: '打开《测试轻小说 第一卷》', exact: true })
    .click();
  await expect(page).toHaveURL(/\/reader\//);
  await expectChapterText(page, '这是一段为自动测试创作的中文译文。');
  await context.setOffline(false);
});

test('distinguishes no matches from a denied source', async ({ page }) => {
  await page.goto('/discover');
  await page.getByRole('searchbox', { name: '书名、别名或作者' }).fill('空');
  await page.getByRole('button', { name: '搜索书源' }).click();
  await expect(page.getByRole('heading', { name: '未找到作品' })).toBeVisible();
  await page.getByRole('searchbox', { name: '书名、别名或作者' }).fill('故障');
  await page.getByRole('button', { name: '搜索书源' }).click();
  await expect(page.getByRole('alert')).toContainText('书源页面受限');
  await page
    .getByRole('combobox', { name: '书源', exact: true })
    .selectOption('linovelib');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '读取书源窗口', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看卷册' })).toBeVisible();
  await page.getByRole('button', { name: '查看卷册' }).click();
  await expect(
    page.getByRole('checkbox', { name: /测试轻小说 第一卷/ }),
  ).toBeEnabled();
  await expect(
    page.getByRole('checkbox', { name: /测试轻小说 第二卷/ }),
  ).toBeDisabled();
});

test('groups the same work found on every source without merging it', async ({
  page,
}) => {
  await page.goto('/discover');
  await page
    .getByRole('combobox', { name: '书源', exact: true })
    .selectOption('all');
  await expect(
    page.getByRole('button', { name: '读取书源窗口', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('searchbox', { name: '书名、别名或作者' })
    .fill('測試輕小說');
  await page.getByRole('button', { name: '搜索书源' }).click();
  await expect(page.getByText(/未合并/)).toBeVisible();
  await expect(page.getByRole('heading', { name: '测试轻小说' })).toHaveCount(
    1,
  );
  await page.getByRole('button', { name: /查看卷册 · Linovelib/ }).click();
  await expect(
    page.getByRole('checkbox', { name: /测试轻小说 第一卷/ }),
  ).toBeEnabled();
});

test('adds an OPDS catalog, browses it and imports a book', async ({
  page,
}) => {
  await page.goto('/discover');
  await page.getByRole('tab', { name: 'OPDS 书库' }).click();
  await page.getByLabel('名称').fill('测试书库');
  await page.getByLabel('OPDS 地址').fill('https://opds.test/catalog');
  await page.getByRole('button', { name: '添加书库' }).click();
  await page.getByRole('button', { name: /最新书籍/ }).click();
  const book = page.getByRole('listitem').filter({ hasText: '原创测试长篇' });
  await book.getByRole('button', { name: '下载 EPUB 并加入书架' }).click();
  await expect(book.getByText('已加入书架')).toBeVisible();
  await book.getByRole('button', { name: '开始阅读' }).click();
  await expect(page).toHaveURL(/\/reader\//);

  // The catalog list survives a reload.
  await page.goto('/discover');
  await page.getByRole('tab', { name: 'OPDS 书库' }).click();
  await expect(
    page.getByRole('combobox', { name: '书库', exact: true }),
  ).toHaveValue(/.+/);
  await expect(page.getByRole('button', { name: /最新书籍/ })).toBeVisible();
});

test('follows a fetched series and marks volumes already on the shelf', async ({
  page,
}) => {
  await page.goto('/discover');
  await page
    .getByRole('searchbox', { name: '书名、别名或作者' })
    .fill('测试轻小说');
  await page.getByRole('button', { name: '搜索书源' }).click();
  await page.getByRole('button', { name: '查看卷册' }).click();
  await page.getByRole('checkbox', { name: /测试轻小说 第一卷/ }).check();
  await page.getByRole('button', { name: '获取所选 1 卷' }).click();
  await expect(page.getByText('已加入书架', { exact: true })).toBeVisible();
  // The volume list updates as soon as the volume is on the shelf.
  await expect(page.getByText('书架中已有', { exact: true })).toBeVisible();

  await page.goto('/discover');
  const followed = page.getByRole('region', { name: '我的系列' });
  await expect(followed).toContainText('测试轻小说');
  await followed.getByRole('button', { name: '检查新卷' }).click();
  await expect(page.getByText(/书架中已有 1 卷/)).toBeVisible();
  await expect(page.getByText('书架中已有', { exact: true })).toBeVisible();

  // A deep link from the shelf opens the same volume list directly.
  await page.goto('/discover?source=bilinovel&novel=1');
  await expect(page.getByText(/书架中已有 1 卷/)).toBeVisible();
});

test('saves a なろう part as a Japanese EPUB and finds it from the shelf', async ({
  page,
}) => {
  await page.goto('/discover');
  await page.getByRole('tab', { name: 'なろう（日文原作）' }).click();
  await page.getByRole('searchbox').fill('テスト');
  await page.getByRole('button', { name: '搜索なろう' }).click();
  await page.getByRole('button', { name: '查看目录' }).click();
  await page.getByRole('checkbox', { name: /第一部/ }).check();
  await page.getByRole('button', { name: '获取所选 1 卷' }).click();
  await expect(page.getByText('已加入书架', { exact: true })).toBeVisible();

  // The shelf link of the saved work reopens its contents in this tab.
  await page.goto('/discover?source=syosetu&novel=n0001aa');
  await expect(
    page.getByRole('tab', { name: 'なろう（日文原作）' }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(/书架中已有 1 卷/)).toBeVisible();

  await page.goto('/library');
  await page
    .getByRole('button', { name: '打开《テスト用の長編 第一部 はじまり》' })
    .click();
  await expect(page).toHaveURL(/\/reader\//);
});

test('finds a work by its Japanese title and searches its Chinese titles', async ({
  page,
}) => {
  await page.goto('/discover');
  // One search box: the sources and Bangumi are searched together.
  await page
    .getByRole('searchbox', { name: '书名、别名或作者' })
    .fill('テストのライトノベル');
  await page.getByRole('button', { name: '搜索书源' }).click();
  const details = page.getByRole('article', {
    name: '《测试轻小说》的中文信息',
  });
  await expect(details).toContainText('测试出版社');
  await details.getByRole('button', { name: '用 2 个译名搜索书源' }).click();
  // Both sources were searched; the same work is grouped across them.
  await expect(
    page.getByRole('combobox', { name: '书源', exact: true }),
  ).toHaveValue('all');
  await expect(page.getByText(/未合并/)).toBeVisible();

  // From a なろう work, the light-novel tab opens with its title looked up.
  await page.getByRole('tab', { name: 'なろう（日文原作）' }).click();
  await page.getByRole('searchbox').last().fill('テスト');
  await page.getByRole('button', { name: '搜索なろう' }).click();
  await page.getByRole('button', { name: '查看目录' }).click();
  await page.getByRole('button', { name: '查找中文译本' }).click();
  await expect(page.getByRole('tab', { name: '轻小说网站' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    page.getByRole('searchbox', { name: '书名、别名或作者' }),
  ).toHaveValue('テスト用の長編');
  await expect(page.getByRole('article')).toBeVisible();
});
