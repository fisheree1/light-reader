import { expect, test } from '@playwright/test';

test.describe('English interface', () => {
  test.use({ locale: 'en-US' });

  test('follows the system language and can switch to Chinese', async ({
    page,
  }) => {
    await page.goto('/library');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(
      page.getByRole('heading', { name: 'Import your first book' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();

    await page.getByRole('link', { name: 'Settings' }).click();
    await page
      .getByRole('combobox', { name: 'Interface language' })
      .selectOption('zh-CN');
    await expect(
      page.getByRole('heading', { name: '设置', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: '书架' })).toBeVisible();

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('heading', { name: '界面语言' })).toBeVisible();

    await page
      .getByRole('combobox', { name: '界面语言' })
      .selectOption('system');
    await expect(
      page.getByRole('heading', { name: 'Settings', exact: true }),
    ).toBeVisible();
  });
});
