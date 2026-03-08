# Lara E2E - Project Instructions

## Overview
E2E test suite for Lara (translation SaaS) built with Playwright and TypeScript. Uses Page Object Model (POM) pattern.

## Project Structure
```
src/
  config/       - Environment and route-blocking configuration
  fixtures/     - Playwright custom fixtures (base.fixture.ts)
  pages/        - Page Objects (inherit from BasePage)
  components/   - Reusable UI component objects (iframe editor, cookie consent)
  helpers/      - API helpers and test utilities (add as needed)
tests/
  auth/         - Authentication test specs
  smoke/        - Smoke / health-check specs
  translate/    - Translation feature specs
  <feature>/    - One folder per feature domain
docs/           - Architecture, conventions, writing-tests guides
```

## Key Patterns

### Imports
- Tests import `test` and `expect` from `src/fixtures/base.fixture.ts`, NOT from `@playwright/test` directly.
- Page objects and components use `@playwright/test` types only.
- Environment values come from `src/config/env.config.ts`.

### Page Objects
- Every page extends `BasePage` from `src/pages/base.page.ts`.
- Define `readonly path: string` for navigation.
- Expose locators as `readonly` class properties using semantic selectors (`getByRole`, `getByLabel`, `getByTestId`).
- Encapsulate multi-step interactions as methods (e.g., `login(email, password)`).

### Components
- Reusable UI fragments go in `src/components/`.
- `TranslatorEditorComponent` — the core translation editor inside an iframe. All iframe locators are encapsulated here.
- `CookieConsentComponent` — auto-dismisses the Cookiebot dialog on page load.

### Iframe Pattern
- The translation editor lives inside `[data-testid="iframe-element"]`.
- All locators inside the iframe go through `page.getByTestId('iframe-element').contentFrame()`.
- This is encapsulated in `TranslatorEditorComponent` — tests never interact with the iframe directly.
- The app renders mobile + desktop variants of language selectors. Desktop selectors use `#sourceLanguage` / `#targetLanguage` IDs because `getByRole('combobox', { name: 'Source language' })` resolves to 2 elements.

### Fixtures
- Register page objects and shared state in `src/fixtures/base.fixture.ts`.
- Tests receive them as parameters via Playwright's fixture injection.
- The `page` fixture is overridden to:
  1. Block analytics routes (GA4)
  2. Auto-dismiss cookie consent dialog on page load

### Route Blocking (GA4)
- All tests automatically block requests to GA4 and tracking services.
- Blocked URL patterns are defined in `src/config/blocked-routes.config.ts`.
- The `page` fixture in `base.fixture.ts` calls `page.route()` to abort these requests before any test runs.
- This prevents test executions from polluting production analytics data.
- To block additional services, add patterns to `BLOCKED_ROUTES` in `blocked-routes.config.ts`.

### Tests
- Organize by feature domain: `tests/<feature>/<feature>.spec.ts`.
- Use `test.describe` blocks to group related scenarios.
- One assertion concern per test. Keep tests independent and idempotent.
- No hardcoded URLs — use `page.goto('/path')` with the configured `baseURL`.
- ALWAYS explicitly set source and target languages — the app geo-detects defaults which vary by runner location.

### Device Matrix
Currently only `desktop-chrome` (1920x1080) is active. 7 additional projects are defined but commented out in `playwright.config.ts`:
- **Desktop:** `desktop-safari`, `desktop-firefox`, `desktop-edge`
- **Mobile:** `mobile-iphone-15-pro`, `mobile-galaxy-s24`
- **Tablet:** `tablet-ipad-air`
- **Low-end:** `low-end-android`

To enable a project, uncomment it in `playwright.config.ts` and update `.github/workflows/e2e.yml` to install the required browser.

## Commands
- `npm test` - Run all tests
- `npm run test:chromium` - Run on desktop-chrome only
- `npm run test:smoke` - Run smoke tests only
- `npm run test:debug` - Debug mode with inspector
- `npm run test:ui` - Playwright UI mode
- `npm run codegen` - Open Playwright codegen

## Rules
- NEVER allow GA4 or tracking requests to reach external services during tests. All analytics must be blocked via `blocked-routes.config.ts`.
- NEVER use `page.locator('.css-class')` or XPath in spec files. Use semantic locators: `getByRole`, `getByLabel`, `getByText`, `getByTestId`.
- `locator('#id')` is acceptable ONLY inside components when semantic locators resolve to multiple elements (mobile/desktop variants). Always add a comment explaining why.
- NEVER put test data or credentials in code. Use `env.config.ts` and `.env` files.
- NEVER import from `@playwright/test` in spec files. Always use `src/fixtures/base.fixture.ts`.
- NEVER rely on geo-detected default languages. Always explicitly set source/target languages in translation tests.
- ALWAYS add new page objects to the fixtures before using them in tests.
- ALWAYS group tests by feature domain in separate folders under `tests/`.
- Keep spec files focused — one feature or user flow per file.
