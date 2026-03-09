# Lara E2E Tests

End-to-end test suite for Lara using [Playwright](https://playwright.dev/) and TypeScript, with **S3 report storage** for persistent test reports served via CloudFront.

## Quick Start

### E2E Tests

```bash
# Install dependencies
npm install

# Install browsers
npx playwright install --with-deps

# Copy environment file and configure
cp .env.example .env

# Run all tests
npm test

# Run in UI mode (recommended for development)
npm run test:ui
```

### Upload Report to S3

```bash
# After running tests
npm run report:upload -- --status=passed
# Prints: https://d1234.cloudfront.net/reports/2026-03-09T.../index.html
```

## Scripts

### E2E Tests

| Command | Description |
|---|---|
| `npm test` | Run all tests across all browsers |
| `npm run test:chromium` | Run tests on Chromium only |
| `npm run test:smoke` | Run smoke tests |
| `npm run test:headed` | Run tests in headed browser mode |
| `npm run test:debug` | Run with Playwright Inspector |
| `npm run test:ui` | Open Playwright UI mode |
| `npm run report` | Open last HTML report |
| `npm run codegen` | Launch Playwright codegen tool |
| `npm run report:upload` | Upload Playwright report to S3 |

## Project Structure

```
src/
  config/         Environment and secrets configuration
  fixtures/       Custom Playwright fixtures
  pages/          Page Object Model classes
  components/     Reusable UI component objects
  helpers/        API and test utility helpers
tests/
  auth/           Authentication tests
  smoke/          Health-check / smoke tests
  translate/      Translation feature specs
scripts/
  upload-report.ts  Upload report to S3 + update index
docs/
  ARCHITECTURE.md Design decisions and patterns
  CONVENTIONS.md  Coding standards and naming rules
  WRITING-TESTS.md  Step-by-step guide to add new tests
  REPORT-STORAGE.md  S3 report storage reference
```

## Device Matrix

Currently only Desktop Chrome is enabled. Additional projects are defined in `playwright.config.ts` (commented out) and can be enabled as needed.

| Project | Engine | Viewport | Status |
|---|---|---|---|
| `desktop-chrome` | Chromium | 1920x1080 | Active |
| `desktop-safari` | WebKit | 1440x900 | Commented out |
| `desktop-firefox` | Firefox | 1536x864 | Commented out |
| `desktop-edge` | Chromium | 1366x768 | Commented out |
| `mobile-iphone-15-pro` | WebKit | 393x852 | Commented out |
| `mobile-galaxy-s24` | Chromium | 412x915 | Commented out |
| `tablet-ipad-air` | WebKit | 820x1180 | Commented out |
| `low-end-android` | Chromium | 360x800 | Commented out |

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — Design decisions and patterns
- [Conventions](docs/CONVENTIONS.md) — Coding standards
- [Writing Tests](docs/WRITING-TESTS.md) — How to add new tests
- [Report Storage](docs/REPORT-STORAGE.md) — S3 report upload and CloudFront setup

## CI

Tests run automatically on:
- Push / PR to `main`
- Every 10 minutes via cron (synthetic monitoring)
- Manual trigger via `workflow_dispatch`

Currently runs Desktop Chrome only. Reports are uploaded to S3 and a PR comment with the report URL is posted automatically. Artifacts are also retained in GitHub Actions for 7 days.
