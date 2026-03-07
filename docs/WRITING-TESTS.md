# Writing Tests

Step-by-step guide for adding new E2E tests.

## 1. Create the Page Object

Create `src/pages/<name>.page.ts`:

```typescript
import type { Page } from '@playwright/test';
import { BasePage } from './base.page';

export class DashboardPage extends BasePage {
  readonly path = '/dashboard';

  readonly heading = this.page.getByRole('heading', { name: 'Dashboard' });
  readonly statsCard = this.page.getByTestId('stats-card');

  constructor(page: Page) {
    super(page);
  }

  async refreshStats(): Promise<void> {
    await this.page.getByRole('button', { name: 'Refresh' }).click();
  }
}
```

## 2. Register in Fixtures

Edit `src/fixtures/base.fixture.ts`:

```typescript
import { DashboardPage } from '../pages/dashboard.page';

type Fixtures = {
  loginPage: LoginPage;
  dashboardPage: DashboardPage; // Add here
};

export const test = base.extend<Fixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  dashboardPage: async ({ page }, use) => { // Add here
    await use(new DashboardPage(page));
  },
});
```

## 3. Create the Test Spec

Create `tests/<feature>/<name>.spec.ts`:

```typescript
import { test, expect } from '../../src/fixtures/base.fixture';

test.describe('Dashboard', () => {
  test('should display dashboard heading', async ({ dashboardPage }) => {
    await dashboardPage.goto();
    await expect(dashboardPage.heading).toBeVisible();
  });

  test('should refresh stats', async ({ dashboardPage }) => {
    await dashboardPage.goto();
    await dashboardPage.refreshStats();
    await expect(dashboardPage.statsCard).toBeVisible();
  });
});
```

## 4. Run and Verify

```bash
# Run only your new test file
npx playwright test tests/dashboard/dashboard.spec.ts

# Run in debug mode to step through
npx playwright test tests/dashboard/dashboard.spec.ts --debug

# Run in UI mode for visual feedback
npm run test:ui
```

## Working with the Translation Editor

The translation editor lives inside an iframe. All interaction goes through `TranslatorEditorComponent` — never access the iframe directly in tests.

```typescript
test('should translate text', async ({ translatePage }) => {
  await translatePage.goto();
  await translatePage.editor.selectSourceLanguage('English');
  await translatePage.editor.selectTargetLanguage('Italian');
  await translatePage.translate('Hello world!');

  const output = await translatePage.editor.getTranslation();
  await expect(output).toContainText('Ciao mondo');
});
```

Important: always explicitly set source and target languages. The app geo-detects defaults which change based on runner location.

## Adding a Component Object

If a UI fragment is shared across pages (e.g., a modal, toast, sidebar):

1. Create `src/components/<name>.component.ts`
2. Scope it to a root locator
3. Use it inside page objects or directly in fixtures
4. Never put assertions inside components — keep them in tests

## Checklist

Before submitting a new test:
- [ ] Page object created in `src/pages/` or `src/components/`
- [ ] Registered in `src/fixtures/base.fixture.ts`
- [ ] Uses semantic locators only (no CSS/XPath)
- [ ] No hardcoded URLs or credentials
- [ ] Tests are independent and can run in any order
- [ ] Test names start with `should` and describe expected behavior
- [ ] Runs successfully: `npx playwright test <your-spec>`
