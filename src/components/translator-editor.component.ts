import type { Page, FrameLocator, Locator } from '@playwright/test';

/**
 * Encapsulates the translation editor that lives inside an iframe.
 * All locators are scoped to the iframe's contentFrame.
 *
 * The app renders both desktop and mobile language selectors in the DOM.
 * Only one set is visible depending on the viewport width.
 * This component auto-detects which variant is visible and uses it.
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

  /** Returns the visible source language selector, waiting for either variant to appear */
  async getVisibleSourceSelector(): Promise<Locator> {
    return this.waitForVisibleVariant(this.sourceLanguageDesktop, this.sourceLanguageMobile);
  }

  /** Returns the visible target language selector, waiting for either variant to appear */
  async getVisibleTargetSelector(): Promise<Locator> {
    return this.waitForVisibleVariant(this.targetLanguageDesktop, this.targetLanguageMobile);
  }

  /**
   * Waits for either the desktop or mobile variant to become visible and returns it.
   * Throws if neither becomes visible within the timeout.
   */
  private async waitForVisibleVariant(desktop: Locator, mobile: Locator): Promise<Locator> {
    const timeout = 10_000;
    await Promise.race([
      desktop.waitFor({ state: 'visible', timeout }),
      mobile.waitFor({ state: 'visible', timeout }),
    ]).catch(() => {
      throw new Error('Neither desktop nor mobile language selector became visible');
    });
    // Re-check after the race to return the actually visible one
    if (await desktop.isVisible()) return desktop;
    return mobile;
  }

  async typeSource(text: string): Promise<void> {
    await this.sourceInput.click();
    await this.sourceInput.fill(text);
  }

  getTranslation(): Locator {
    return this.translatedText.getByRole('paragraph');
  }

  async openSourceLanguageDropdown(): Promise<void> {
    const selector = await this.getVisibleSourceSelector();
    await selector.click();
  }

  async selectSourceLanguage(language: string): Promise<void> {
    const selector = await this.getVisibleSourceSelector();
    await selector.click();
    await this.frame.getByRole('combobox', { name: 'Search' }).fill(language);
    await this.frame.getByRole('option', { name: language, exact: true }).click();
    await this.waitForEditorReady();
  }

  async selectTargetLanguage(language: string): Promise<void> {
    const selector = await this.getVisibleTargetSelector();
    await selector.click();
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
