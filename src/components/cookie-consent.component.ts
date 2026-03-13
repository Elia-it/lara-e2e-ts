import type { Page, Locator } from '@playwright/test';

export class CookieConsentComponent {
  private readonly page: Page;

  readonly dialog: Locator;
  // Cookiebot stable IDs — locale-independent
  readonly allowAllButton: Locator;
  readonly customizeButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.dialog = page.locator('#CybotCookiebotDialog');
    this.allowAllButton = page.locator('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll');
    this.customizeButton = page.locator('#CybotCookiebotDialogBodyLevelButtonCustomize');
  }

  async acceptIfVisible(): Promise<void> {
    try {
      await this.allowAllButton.click({ timeout: 3000 });
    } catch {
      // Cookie dialog not present — continue
    }
  }
}
