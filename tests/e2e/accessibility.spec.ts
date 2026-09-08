import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectNoAccessibilityViolations(
  page: Page,
  includes: string[] = [],
) {
  let audit = new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
  ]);
  for (const selector of includes) audit = audit.include(selector);
  const results = await audit.analyze();
  expect(
    results.violations,
    results.violations
      .map(
        (violation) =>
          `${violation.id}: ${violation.help} (${violation.nodes
            .flatMap((node) => node.target)
            .join(', ')})`,
      )
      .join('\n'),
  ).toEqual([]);
}

test('keeps the application shell keyboard reachable and axe clean', async ({
  page,
}) => {
  await page.goto('/library');
  await expectNoAccessibilityViolations(page);

  const notesLink = page.getByRole('link', { name: '笔记' });
  await notesLink.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/notes$/);
  await expect(
    page.getByRole('heading', { name: '笔记', exact: true }),
  ).toBeVisible();

  const themeButton = page.getByRole('button', { name: '切换到深色主题' });
  await themeButton.focus();
  await expect(themeButton).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('restores dialog focus and audits the Foliate content region', async ({
  page,
}) => {
  await page.goto('/library');
  await page.getByRole('button', { name: '导入电子书' }).click();
  await page.getByRole('button', { name: '打开《Web 测试 EPUB》' }).click();
  await expect(page.getByRole('button', { name: '第一章' })).toBeVisible();

  const settingsButton = page.getByRole('button', { name: '阅读设置' });
  await settingsButton.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '阅读设置' });
  await expect(dialog).toBeVisible();
  await expectNoAccessibilityViolations(page, ['[role="dialog"]']);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(settingsButton).toBeFocused();

  await expectNoAccessibilityViolations(page, ['[aria-label="EPUB 正文"]']);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: '下一页' })).toBeEnabled();
});

test('audits the Tiptap toolbar and supports keyboard formatting', async ({
  page,
}) => {
  await page.goto('/notes');
  await page.getByRole('button', { name: '新建笔记' }).click();
  const editor = page.getByRole('textbox', { name: '笔记正文' });
  await expect(editor).toBeVisible();

  await expectNoAccessibilityViolations(page, [
    '[role="toolbar"]',
    '[aria-label="笔记正文"]',
  ]);

  const boldButton = page.getByRole('button', { name: '粗体' });
  await boldButton.focus();
  await expect(boldButton).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(boldButton).toHaveAttribute('aria-pressed', 'true');
  await expect(editor).toBeFocused();
});

test('keeps local AI settings and consent dialog accessible', async ({
  page,
}) => {
  await page.goto('/settings');
  await expectNoAccessibilityViolations(page, [
    '[aria-labelledby="ai-settings-title"]',
  ]);
  await page.getByLabel('启用本地 AI 助手').check();
  await page.getByRole('button', { name: '保存 AI 设置' }).click();

  await page.goto('/library');
  await page.getByRole('button', { name: '导入电子书' }).click();
  await page.getByRole('button', { name: '打开《Web 测试 EPUB》' }).click();
  await expect(page.getByRole('button', { name: '第一章' })).toBeVisible();

  let contentFrame = page
    .frames()
    .find((frame) => frame.url().startsWith('blob:'));
  await expect
    .poll(() => {
      contentFrame = page
        .frames()
        .find((frame) => frame.url().startsWith('blob:'));
      return contentFrame !== undefined;
    })
    .toBe(true);
  if (!contentFrame) throw new Error('EPUB content frame was not created');
  await contentFrame
    .getByText('这是 LightReader 自制的无版权测试内容。')
    .selectText();

  const trigger = page.getByRole('button', { name: 'AI 助手' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '本地 AI 阅读助手' });
  await expect(dialog).toBeVisible();
  await expectNoAccessibilityViolations(page, ['[role="dialog"]']);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
