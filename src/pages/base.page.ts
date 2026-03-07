import type { Page } from '@playwright/test';

export abstract class BasePage {
  constructor(protected readonly page: Page) {}

  abstract readonly path: string;

  async goto(): Promise<void> {
    await this.page.goto(this.path);
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
  }
}
