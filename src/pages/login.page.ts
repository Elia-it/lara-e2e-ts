import type { Page } from '@playwright/test';
import { BasePage } from './base.page';
import { env } from '../config/env.config';

export class LoginPage extends BasePage {
  // Login lives on the app domain, not the website domain
  readonly path = `${env.APP_URL}/login`;

  readonly emailInput = this.page.getByRole('textbox', { name: 'Email' });
  readonly passwordInput = this.page.getByRole('textbox', { name: 'Password' });
  readonly submitButton = this.page.getByRole('button', { name: 'Continue' });
  readonly errorMessage = this.page.getByText('Authentication failed');

  constructor(page: Page) {
    super(page);
  }

  async login(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}
