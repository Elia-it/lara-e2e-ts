import { test, expect } from '../../src/fixtures/base.fixture';

test.describe('Login', () => {
  test('should display login form', async ({ loginPage }) => {
    await loginPage.goto();
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.submitButton).toBeVisible();
  });

});
