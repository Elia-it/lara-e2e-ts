# Architecture

## Design Decisions

### Page Object Model (POM)
Every page in the application has a corresponding class in `src/pages/`. This separates **what** a test does from **how** the UI works.

```
Test:        "login with valid credentials"
Page Object: LoginPage.login(email, password)
Locators:    emailInput, passwordInput, submitButton
```

Benefits:
- When UI changes, update one page object instead of many tests.
- Tests read as user stories, not DOM manipulation.

### Custom Fixtures
Playwright fixtures replace `beforeEach`/`afterEach` boilerplate. All page objects are registered in `src/fixtures/base.fixture.ts` and injected into tests automatically.

```typescript
// Bad - manual setup in every test
test('login', async ({ page }) => {
  const loginPage = new LoginPage(page);
  ...
});

// Good - fixture injection
test('login', async ({ loginPage }) => {
  ...
});
```

### Component Objects
Shared UI fragments are modeled as component objects in `src/components/`. They are scoped to a root locator and can be composed into page objects.

Current components:
- **`TranslatorEditorComponent`** — Encapsulates the translation editor iframe. All `contentFrame()` access is isolated here. Exposes language selectors, source input, translation output, and navigation tabs.
- **`CookieConsentComponent`** — Auto-dismisses the Cookiebot cookie consent dialog. Integrated into the `page` fixture so tests never need to handle it manually.

### Iframe Handling
The Lara translation editor is embedded in an iframe (`[data-testid="iframe-element"]`). Key decisions:
- All iframe interaction is encapsulated in `TranslatorEditorComponent` — no test or page object touches `contentFrame()` directly.
- The app renders **mobile and desktop variants** of language selectors (e.g., `#sourceLanguageMobile` vs `#sourceLanguage`). At desktop viewports both exist in DOM, so `getByRole('combobox', { name: 'Source language' })` resolves to 2 elements. We use `locator('#sourceLanguage')` to target the desktop variant specifically.
- This is the only acceptable use of ID selectors — documented with comments in the component.

### Cookie Consent
The site uses Cookiebot which shows a blocking dialog on first visit. The `page` fixture listens for `load` events and auto-clicks "Allow all" if the dialog appears. This runs silently with a 3-second timeout — if no dialog, the test continues immediately.

### Route Blocking (GA4 / Analytics)
Test runs must never send data to Google Analytics 4 or any tracking service. This is handled automatically via Playwright's `page.route()` API.

- `src/config/blocked-routes.config.ts` defines all URL patterns to block.
- The `page` fixture in `base.fixture.ts` registers these routes before every test, aborting matching requests.
- Blocked services: Google Analytics, Google Tag Manager, GA4 Measurement Protocol.

To add a new blocked service, append a glob pattern to the `BLOCKED_ROUTES` array:

```typescript
// src/config/blocked-routes.config.ts
export const BLOCKED_ROUTES: string[] = [
  '**/google-analytics.com/**',
  '**/analytics.google.com/**',
  '**/googletagmanager.com/**',
  '**/collect?v=2**',
  // Add new patterns here
];
```

### Device Matrix (Synthetic Monitoring)
Currently only `desktop-chrome` is active. 7 additional projects are defined but commented out in `playwright.config.ts`, covering ~95% of the modern business user market when fully enabled.

| Project | Engine | Viewport | Use Case | Status |
|---|---|---|---|---|
| `desktop-chrome` | Chromium | 1920x1080 | Windows 11 standard | Active |
| `desktop-safari` | WebKit | 1440x900 | macOS Sonoma | Commented out |
| `desktop-firefox` | Firefox | 1536x864 | Linux / Ubuntu | Commented out |
| `desktop-edge` | Chromium | 1366x768 | Enterprise Windows | Commented out |
| `mobile-iphone-15-pro` | WebKit | 393x852 | iOS flagship | Commented out |
| `mobile-galaxy-s24` | Chromium | 412x915 | Android flagship | Commented out |
| `tablet-ipad-air` | WebKit | 820x1180 | Tablet portrait | Commented out |
| `low-end-android` | Chromium | 360x800 | Budget Android / Pixel 7 | Commented out |

To enable additional projects, uncomment them in `playwright.config.ts` and update `.github/workflows/e2e.yml` to install the required browsers and (optionally) restore the matrix strategy.

**Artifact policy** (optimized for high-frequency runs):
- `screenshot: 'only-on-failure'` - minimize storage
- `video: 'off'` - avoid large artifacts
- `trace: 'retain-on-failure'` - debug failures only
- `timeout: 30s` - catch performance regressions fast
- `retries: 2` (CI) - filter transient network noise

**CI schedule:** Runs every 10 minutes via GitHub Actions cron.

### Environment Configuration
All environment-dependent values live in `src/config/env.config.ts`, loaded from `.env` at runtime. Tests never contain hardcoded URLs, credentials, or environment-specific logic.

### Semantic Locators
Tests use Playwright's semantic locator APIs exclusively:
- `getByRole` - buttons, links, headings
- `getByLabel` - form inputs
- `getByText` - static text content
- `getByTestId` - fallback for elements without accessible names

CSS selectors and XPath are not used. This makes tests resilient to refactors and enforces accessibility.

Exception: `locator('#id')` is used inside `TranslatorEditorComponent` for language selectors that have duplicate `aria-label` across mobile/desktop variants. See [Conventions](CONVENTIONS.md) for the full rule.

### Geo-Independent Tests
The app auto-detects target language based on the runner's location (e.g., Italian in Italy, German in Frankfurt). Translation tests must always explicitly set both source and target languages to ensure deterministic results regardless of where CI runs.

## S3 Report Storage

Playwright HTML reports are uploaded directly to S3 and served via CloudFront. No API server or database needed.

### Architecture

```
Playwright CI  ──npx tsx──▶  scripts/upload-report.ts  ──▶  S3 (reports/)
                                                         ──▶  CloudFront (public read)
```

### How It Works

1. CI runs Playwright tests, producing `playwright-report/`.
2. `scripts/upload-report.ts` uploads the entire report directory to S3 under `reports/{timestamp}_{branch}_{sha}/`.
3. The script updates `reports/manifest.json` (run metadata) and regenerates `reports/index.html` (static dashboard).
4. S3 lifecycle policy auto-deletes objects under `reports/` after 31 days.
5. CloudFront with OAC provides public HTTPS access while keeping the S3 bucket private.

### Key Decisions

- **No API server:** Playwright's HTML report is already an interactive dashboard. We just host it.
- **No database:** `manifest.json` in S3 stores run metadata. The upload script prunes old entries.
- **S3 lifecycle for retention:** No cron jobs needed. AWS handles expiration automatically.
- **CloudFront + OAC:** S3 stays fully private. CloudFront provides caching and HTTPS.

See [Report Storage docs](REPORT-STORAGE.md) for the full setup and usage guide.

## Folder Conventions

| Path | Purpose | Naming |
|---|---|---|
| `src/pages/` | One class per app page | `<name>.page.ts` |
| `src/components/` | Reusable UI fragments | `<name>.component.ts` |
| `src/fixtures/` | Playwright fixture extensions | `<name>.fixture.ts` |
| `src/helpers/` | API clients, data builders | `<name>.helper.ts` |
| `src/config/` | Environment, constants | `<name>.config.ts` |
| `tests/<feature>/` | Spec files grouped by domain | `<name>.spec.ts` |
| `scripts/` | Build/upload scripts | `upload-report.ts` |
