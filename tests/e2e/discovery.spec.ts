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
