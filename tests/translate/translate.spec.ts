import { test, expect } from '../../src/fixtures/base.fixture';

test.describe('Translation', () => {
  test('should detect source language after input', async ({ translatePage }) => {
    await translatePage.goto();
    await translatePage.translate('Hello world!');

    await translatePage.editor.openSourceLanguageDropdown();
    const sourceSelector = await translatePage.editor.getVisibleSourceSelector();
    await expect(sourceSelector).toContainText('English');
  });

  test('should translate with explicit source and target language', async ({ translatePage }) => {
    await translatePage.goto();
    await translatePage.editor.selectSourceLanguage('English');
    await translatePage.editor.selectTargetLanguage('Spanish (Spain)');
    await translatePage.translate('Hello World!');

    const output = translatePage.editor.getTranslation();
    await expect(output).not.toBeEmpty();
  });
});
