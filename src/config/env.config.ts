import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const env = {
  BASE_URL: process.env.BASE_URL ?? 'https://lara-website.staging.translated.cloud',
  APP_URL: process.env.APP_URL ?? 'https://app.laratranslate.com',
  TEST_USER_EMAIL: process.env.TEST_USER_EMAIL ?? 'test@example.com',
  TEST_USER_PASSWORD: process.env.TEST_USER_PASSWORD ?? 'changeme',
  UI_LANGUAGE: process.env.UI_LANGUAGE ?? 'English',
  ENV: process.env.ENV ?? 'local',
  CI: !!process.env.CI,
} as const;
