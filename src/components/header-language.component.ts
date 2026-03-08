import type { Page } from '@playwright/test';

export class HeaderLanguageComponent {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async selectLanguage(language: string): Promise<void> {
    await this.page.getByTestId('header-language-menu-button').click();
    await this.page.getByRole('option', { name: language }).click();
  }
}
