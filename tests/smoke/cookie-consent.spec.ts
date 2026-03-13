import { test as base, expect } from '../../src/fixtures/base.fixture';
import { CookieConsentComponent } from '../../src/components/cookie-consent.component';
import { BLOCKED_ROUTES } from '../../src/config/blocked-routes.config';

// Override the base page fixture:
// 1. Unroute blocked patterns — Cookiebot may load via GTM which the base fixture blocks
// 2. Clear the pre-set CookieConsent cookie so the dialog appears
const test = base.extend<{ cookieConsent: CookieConsentComponent }>({
  page: async ({ page }, use) => {
    await Promise.all(BLOCKED_ROUTES.map((pattern) => page.unroute(pattern)));
    await page.context().clearCookies();
    await use(page);
  },
  cookieConsent: async ({ page }, use) => {
    await use(new CookieConsentComponent(page));
  },
});

// Cookiebot loads from a third-party CDN — allow extra time for the dialog to appear
const DIALOG_TIMEOUT = 15_000;

test.describe('Cookie Consent', () => {
  test('should display the cookie consent dialog on first visit', async ({ page, cookieConsent }) => {
    await page.goto('/');

    await expect(cookieConsent.dialog).toBeVisible({ timeout: DIALOG_TIMEOUT });
    await expect(cookieConsent.allowAllButton).toBeVisible();
    await expect(cookieConsent.customizeButton).toBeVisible();
  });

  test('should dismiss the dialog after accepting all cookies', async ({ page, cookieConsent }) => {
    await page.goto('/');

    await expect(cookieConsent.dialog).toBeVisible({ timeout: DIALOG_TIMEOUT });
    await cookieConsent.allowAllButton.click();
    await expect(cookieConsent.dialog).toBeHidden();
  });

  test('should not show the dialog again after accepting', async ({ page, cookieConsent }) => {
    await page.goto('/');
    await expect(cookieConsent.dialog).toBeVisible({ timeout: DIALOG_TIMEOUT });
    await cookieConsent.allowAllButton.click();
    await expect(cookieConsent.dialog).toBeHidden();

    // Reload and verify it stays dismissed
    await page.reload();
    await expect(cookieConsent.dialog).toBeHidden();
  });
});
