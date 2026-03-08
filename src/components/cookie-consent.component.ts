import type { Page } from '@playwright/test';

export class CookieConsentComponent {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async acceptIfVisible(): Promise<void> {
    try {
      await this.page.getByRole('button', { name: 'Allow all' }).click({ timeout: 3000 });
    } catch {
      // Cookie dialog not present — continue
    }
  }
}
