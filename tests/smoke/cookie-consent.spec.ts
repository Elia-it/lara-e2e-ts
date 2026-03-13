import { test as base, expect } from '@playwright/test';
import { CookieConsentComponent } from '../../src/components/cookie-consent.component';
import { BLOCKED_ROUTES } from '../../src/config/blocked-routes.config';

// Raw fixture without auto-dismiss — we need the cookie dialog to remain visible
const test = base.extend<{ cookieConsent: CookieConsentComponent }>({
  page: async ({ page }, use) => {
    await Promise.all(
      BLOCKED_ROUTES.map((pattern) => page.route(pattern, (route) => route.abort())),
    );
    await use(page);
  },
  cookieConsent: async ({ page }, use) => {
    await use(new CookieConsentComponent(page));
  },
});

test.describe('Cookie Consent', () => {
  test('should display the cookie consent dialog on first visit', async ({ page, cookieConsent }) => {
    await page.goto('/');

    await expect(cookieConsent.dialog).toBeVisible();
    await expect(cookieConsent.allowAllButton).toBeVisible();
    await expect(cookieConsent.customizeButton).toBeVisible();
  });

  test('should dismiss the dialog after accepting all cookies', async ({ page, cookieConsent }) => {
    await page.goto('/');

    await expect(cookieConsent.dialog).toBeVisible();
    await cookieConsent.allowAllButton.click();
    await expect(cookieConsent.dialog).toBeHidden();
  });

  test('should not show the dialog again after accepting', async ({ page, cookieConsent }) => {
    await page.goto('/');
    await cookieConsent.allowAllButton.click();
    await expect(cookieConsent.dialog).toBeHidden();

    // Reload and verify it stays dismissed
    await page.reload();
    await expect(cookieConsent.dialog).toBeHidden();
  });
});
