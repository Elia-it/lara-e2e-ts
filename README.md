# Lara E2E Tests

End-to-end test suite for Lara using [Playwright](https://playwright.dev/) and TypeScript.

## Quick Start

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

## Scripts

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
docs/
  ARCHITECTURE.md Design decisions and patterns
  CONVENTIONS.md  Coding standards and naming rules
  WRITING-TESTS.md  Step-by-step guide to add new tests
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

- [Architecture](docs/ARCHITECTURE.md) - Design decisions and patterns
- [Conventions](docs/CONVENTIONS.md) - Coding standards
- [Writing Tests](docs/WRITING-TESTS.md) - How to add new tests

## CI

Tests run automatically on:
- Push / PR to `main`
- Every 10 minutes via cron (synthetic monitoring)
- Manual trigger via `workflow_dispatch`

Currently runs Desktop Chrome only. Reports are uploaded as artifacts and retained for 7 days.
