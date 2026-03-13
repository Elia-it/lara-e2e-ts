import { test, expect } from '../../src/fixtures/base.fixture';

test.describe('Smoke Tests', () => {
  test('should load the application', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/.+/);
  });

  test('should display the translation editor', async ({ translatePage }) => {
    await translatePage.goto();

    await expect(await translatePage.editor.getVisibleSourceSelector()).toBeVisible();
    await expect(await translatePage.editor.getVisibleTargetSelector()).toBeVisible();
    await expect(translatePage.editor.translateTextTab).toBeVisible();
    await expect(translatePage.editor.translateDocumentsTab).toBeVisible();
    await expect(translatePage.editor.interpreterTab).toBeVisible();
  });

  test('should translate text successfully', async ({ translatePage }) => {
    await translatePage.goto();
    await translatePage.editor.selectTargetLanguage('Italian');
    await translatePage.translate('Hello world!');

    const output = translatePage.editor.getTranslation();
    await expect(output).toContainText('Ciao mondo!');
  });
});
