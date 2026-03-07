import { test, expect } from '../../src/fixtures/base.fixture';

test.describe('Login', () => {
  test('should display login form', async ({ loginPage }) => {
    await loginPage.goto();
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.submitButton).toBeVisible();
  });

  test('should show error for invalid credentials', async ({ loginPage }) => {
    await loginPage.goto();
    await loginPage.login('wrong@email.com', 'wrongpassword');
    await expect(loginPage.errorMessage).toBeVisible();
  });
});
