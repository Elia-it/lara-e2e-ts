import { test as base } from '@playwright/test';
import { TranslatePage } from '../pages/translate.page';
import { BLOCKED_ROUTES } from '../config/blocked-routes.config';
import { env } from '../config/env.config';

type Fixtures = {
  translatePage: TranslatePage;
};

export const test = base.extend<Fixtures>({
  page: async ({ page }, use) => {
    await Promise.all(
      BLOCKED_ROUTES.map((pattern) => page.route(pattern, (route) => route.abort())),
    );

    // Pre-set Cookiebot consent cookie so the dialog never appears during tests.
    // Format matches Cookiebot's CookieConsent cookie structure (URL-encoded JSON-like object).
    const cookieConsentValue = encodeURIComponent(
      "{stamp:'-1',necessary:true,preferences:true,statistics:true,marketing:true,method:'explicit',ver:1}",
    );
    const domain = new URL(env.BASE_URL).hostname;
    await page.context().addCookies([
      {
        name: 'CookieConsent',
        value: cookieConsentValue,
        domain,
        path: '/',
      },
    ]);

    await use(page);
  },

  translatePage: async ({ page }, use) => {
    await use(new TranslatePage(page));
  },
});

export { expect } from '@playwright/test';
