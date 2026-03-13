import { defineConfig, devices } from '@playwright/test';
import { env } from './src/config/env.config';

export default defineConfig({
  testDir: './tests',
  timeout: env.CI ? 45_000 : 30_000,
  fullyParallel: true,
  forbidOnly: env.CI,
  retries: env.CI ? 2 : 1,
  workers: env.CI ? 4 : undefined,
  reporter: env.CI
    ? [['github'], ['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results.json' }]]
    : [['html', { open: 'on-failure' }]],

  expect: {
    timeout: env.CI ? 15_000 : 10_000,
  },

  use: {
    baseURL: env.BASE_URL,
    locale: 'en-US',
    actionTimeout: env.CI ? 20_000 : 15_000,
    navigationTimeout: env.CI ? 30_000 : 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    // --- Desktop ---
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
      },
    },
    {
      name: 'desktop-safari',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'desktop-firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1536, height: 864 },
      },
    },
    {
      name: 'desktop-edge',
      use: {
        ...devices['Desktop Edge'],
        viewport: { width: 1366, height: 768 },
      },
    },

    // --- Mobile ---
    {
      name: 'mobile-iphone-15-pro',
      use: {
        ...devices['iPhone 15 Pro'],
      },
    },
    {
      name: 'mobile-galaxy-s24',
      use: {
        browserName: 'chromium',
        viewport: { width: 412, height: 915 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent:
          'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
      },
    },

    // --- Tablet ---
    {
      name: 'tablet-ipad-mini',
      use: {
        ...devices['iPad Mini'],
      },
    },

    // --- Low-end / Performance ---
    {
      name: 'low-end-android',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 360, height: 800 },
      },
    },
  ],
});
