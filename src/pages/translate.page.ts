import type { Page } from '@playwright/test';
import { BasePage } from './base.page';
import { TranslatorEditorComponent } from '../components/translator-editor.component';

export class TranslatePage extends BasePage {
  readonly path = '/translate';
  readonly editor: TranslatorEditorComponent;
  readonly headerLoginLink = this.page.getByTestId('header-login-link');

  constructor(page: Page) {
    super(page);
    this.editor = new TranslatorEditorComponent(page);
  }

  async translate(text: string): Promise<void> {
    await this.editor.typeSource(text);
  }
}
