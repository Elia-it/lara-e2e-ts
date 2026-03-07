import { defineConfig, devices } from '@playwright/test';
import { env } from './src/config/env.config';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: env.CI,
  retries: env.CI ? 2 : 0,
  workers: env.CI ? 1 : undefined,
  reporter: env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['html', { open: 'on-failure' }]],

  use: {
    baseURL: env.BASE_URL,
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
    /*{
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
      name: 'tablet-ipad-air',
      use: {
        ...devices['iPad Air'],
      },
    },

    // --- Low-end / Performance ---
    {
      name: 'low-end-android',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 360, height: 800 },
      },
    },*/
  ],
});
