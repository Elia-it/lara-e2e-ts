import { test as base } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { TranslatePage } from '../pages/translate.page';
import { CookieConsentComponent } from '../components/cookie-consent.component';
import { HeaderLanguageComponent } from '../components/header-language.component';
import { BLOCKED_ROUTES } from '../config/blocked-routes.config';
import { env } from '../config/env.config';

type Fixtures = {
  loginPage: LoginPage;
  translatePage: TranslatePage;
};

export const test = base.extend<Fixtures>({
  page: async ({ page }, use) => {
    await Promise.all(
      BLOCKED_ROUTES.map((pattern) => page.route(pattern, (route) => route.abort())),
    );

    // Dismiss cookie consent on every page load (covers cross-domain navigations)
    const cookieConsent = new CookieConsentComponent(page);
    page.on('load', () => cookieConsent.acceptIfVisible());

    // Set UI language to ensure deterministic locale
    await page.goto('/');
    await cookieConsent.acceptIfVisible();
    const headerLanguage = new HeaderLanguageComponent(page);
    await headerLanguage.selectLanguage(env.UI_LANGUAGE);

    await use(page);
  },

  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  translatePage: async ({ page }, use) => {
    await use(new TranslatePage(page));
  },
});

export { expect } from '@playwright/test';
