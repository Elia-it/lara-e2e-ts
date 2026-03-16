import type { Page, FrameLocator, Locator } from '@playwright/test';

/**
 * Encapsulates the translation editor that lives inside an iframe.
 * All locators are scoped to the iframe's contentFrame.
 *
 * The app renders both desktop and mobile language selectors in the DOM.
 * Only one set is visible depending on the viewport width (Tailwind `lg` = 1024px).
 * This component uses the viewport to pick the correct variant deterministically.
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

  // Language selectors — desktop and mobile variants
  private readonly sourceLanguageDesktop: Locator;
  private readonly targetLanguageDesktop: Locator;
  private readonly sourceLanguageMobile: Locator;
  private readonly targetLanguageMobile: Locator;

  constructor(page: Page) {
    this.page = page;
    this.frame = page.getByTestId('iframe-element').contentFrame();
    this.sourceInput = this.frame.getByTestId('source-editable');
    this.translatedText = this.frame.getByTestId('translatedText');
    this.translateTextTab = this.frame.getByRole('link', { name: 'Translate text' });
    this.translateDocumentsTab = this.frame.getByRole('link', { name: 'Translate documents' });
    this.interpreterTab = this.frame.getByRole('link', { name: 'Interpreter' });
    // Desktop and mobile selectors coexist in DOM — only one set is visible per viewport
    this.sourceLanguageDesktop = this.frame.locator('#sourceLanguage');
    this.targetLanguageDesktop = this.frame.locator('#targetLanguage');
    this.sourceLanguageMobile = this.frame.locator('#sourceLanguageMobile');
    this.targetLanguageMobile = this.frame.locator('#targetLanguageMobile');
  }

  /** Returns the source language selector matching the current viewport */
  async getVisibleSourceSelector(): Promise<Locator> {
    const selector = this.isMobileViewport() ? this.sourceLanguageMobile : this.sourceLanguageDesktop;
    await selector.waitFor({ state: 'visible' });
    return selector;
  }

  /** Returns the target language selector matching the current viewport */
  async getVisibleTargetSelector(): Promise<Locator> {
    const selector = this.isMobileViewport() ? this.targetLanguageMobile : this.targetLanguageDesktop;
    await selector.waitFor({ state: 'visible' });
    return selector;
  }

  /** Tailwind `lg` breakpoint is 1024px — below that, mobile selectors are shown */
  private isMobileViewport(): boolean {
    const viewport = this.page.viewportSize();
    return !viewport || viewport.width < 1024;
  }

  async typeSource(text: string): Promise<void> {
    await this.sourceInput.click();
    await this.sourceInput.fill(text);
  }

  getTranslation(): Locator {
    return this.translatedText;
  }

  async openSourceLanguageDropdown(): Promise<void> {
    const selector = await this.getVisibleSourceSelector();
    await selector.click();
  }

  async selectSourceLanguage(language: string): Promise<void> {
    const selector = await this.getVisibleSourceSelector();
    // Skip if already set (geo-detected default may match)
    if (await this.isLanguageAlreadySelected(selector, language)) return;
    await selector.click();
    await this.frame.getByRole('combobox', { name: 'Search' }).fill(language);
    await this.frame.getByRole('option', { name: language, exact: true }).click();
    await this.waitForEditorReady();
  }

  async selectTargetLanguage(language: string): Promise<void> {
    const selector = await this.getVisibleTargetSelector();
    // Skip if already set (geo-detected default may match)
    if (await this.isLanguageAlreadySelected(selector, language)) return;
    await selector.click();
    await this.frame.getByRole('combobox', { name: 'Search' }).fill(language);
    await this.frame.getByRole('option', { name: language }).first().click();
    await this.waitForEditorReady();
  }

  private async isLanguageAlreadySelected(selector: Locator, language: string): Promise<boolean> {
    const text = await selector.textContent();
    return text?.includes(language) ?? false;
  }

  private async waitForEditorReady(): Promise<void> {
    // Language selection triggers an iframe reload — wait for the old input to detach, then the new one to appear
    await this.sourceInput.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {
      // Input may never become hidden if iframe reloads fast — that's fine
    });
    await this.sourceInput.waitFor({ state: 'attached' });
    await this.sourceInput.waitFor({ state: 'visible' });
    // Wait for language selectors to stabilize — the iframe rebuild may still be in progress
    const targetSelector = this.isMobileViewport() ? this.targetLanguageMobile : this.targetLanguageDesktop;
    await targetSelector.waitFor({ state: 'visible' });
  }
}
