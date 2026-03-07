import { test, expect } from '../../src/fixtures/base.fixture';

test.describe('Translation', () => {
  test('should detect source language after input', async ({ translatePage }) => {
    await translatePage.goto();
    await translatePage.translate('Hello world!');

    await translatePage.editor.openSourceLanguageDropdown();
    await expect(translatePage.editor.sourceLanguageSelector).toContainText('English(detected)');
  });

  test('should translate text from English to Spanish', async ({ translatePage }) => {
    await translatePage.goto();
    await translatePage.editor.selectSourceLanguage('English');
    await translatePage.editor.selectTargetLanguage('Spanish (Spain)');
    await translatePage.translate('Hello World!');

    const output = await translatePage.editor.getTranslation();
    await expect(output).toContainText('¡Hola, mundo!');
  });
});
