import type { Page, FrameLocator, Locator } from '@playwright/test';

/**
 * Encapsulates the translation editor that lives inside an iframe.
 * All locators are scoped to the iframe's contentFrame.
 */
export class TranslatorEditorComponent {
  private readonly page: Page;
  private readonly frame: FrameLocator;

  // Editor
  readonly sourceInput: Locator;
  readonly translatedText: Locator;

  // Navigation tabs
  readonly translateTextTab: Locator;
  readonly translateDocumentsTab: Locator;
  readonly interpreterTab: Locator;

  // Language selectors (desktop)
  readonly sourceLanguageSelector: Locator;
  readonly targetLanguageSelector: Locator;

  constructor(page: Page) {
    this.page = page;
    this.frame = page.getByTestId('iframe-element').contentFrame();
    this.sourceInput = this.frame.getByTestId('source-editable');
    this.translatedText = this.frame.getByTestId('translatedText');
    this.translateTextTab = this.frame.getByRole('link', { name: 'Translate text' });
    this.translateDocumentsTab = this.frame.getByRole('link', { name: 'Translate documents' });
    this.interpreterTab = this.frame.getByRole('link', { name: 'Interpreter' });
    // Desktop selectors — mobile variants (#sourceLanguageMobile, #targetLanguageMobile) are hidden at desktop viewports
    this.sourceLanguageSelector = this.frame.locator('#sourceLanguage');
    this.targetLanguageSelector = this.frame.locator('#targetLanguage');
  }

  async typeSource(text: string): Promise<void> {
    await this.sourceInput.click();
    await this.sourceInput.fill(text);
  }

  async getTranslation(): Promise<Locator> {
    return this.translatedText.getByRole('paragraph');
  }

  async openSourceLanguageDropdown(): Promise<void> {
    await this.sourceLanguageSelector.click();
  }

  async selectSourceLanguage(language: string): Promise<void> {
    await this.sourceLanguageSelector.click();
    await this.frame.getByRole('combobox', { name: 'Search' }).fill(language);
    await this.frame.getByRole('option', { name: language, exact: true }).click();
    await this.waitForEditorReady();
  }

  async selectTargetLanguage(language: string): Promise<void> {
    await this.targetLanguageSelector.click();
    await this.frame.getByRole('combobox', { name: 'Search' }).fill(language);
    await this.frame.getByRole('option', { name: language }).first().click();
    await this.waitForEditorReady();
  }

  private async waitForEditorReady(): Promise<void> {
    // Language selection triggers an iframe reload — wait for the old input to detach, then the new one to appear
    await this.sourceInput.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {
      // Input may never become hidden if iframe reloads fast — that's fine
    });
    await this.sourceInput.waitFor({ state: 'attached' });
    await this.sourceInput.waitFor({ state: 'visible' });
  }
}
