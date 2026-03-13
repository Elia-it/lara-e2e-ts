import { test as base } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { TranslatePage } from '../pages/translate.page';
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

    // Pre-set Cookiebot consent cookie so the dialog never appears during tests.
    // The cookie consent smoke test uses its own fixture and is unaffected.
    const domain = new URL(env.BASE_URL).hostname;
    await page.context().addCookies([
      {
        name: 'CookieConsent',
        value: '{stamp:%27-1%27%2Cnecessary:true%2Cpreferences:true%2Cstatistics:true%2Cmarketing:true%2Cmethod:%27explicit%27%2Cver:1}',
        domain,
        path: '/',
      },
    ]);

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
