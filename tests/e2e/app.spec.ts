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
