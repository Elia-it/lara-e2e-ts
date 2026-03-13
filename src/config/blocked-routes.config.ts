/**
 * URL patterns to block during test execution.
 * Prevents tests from polluting analytics and tracking services.
 * Uses Playwright's glob pattern matching for `page.route()`.
 */
export const BLOCKED_ROUTES: string[] = [
  // Google Analytics 4
  '**/google-analytics.com/**',
  '**/analytics.google.com/**',
  '**/googletagmanager.com/**',

  // GA4 Measurement Protocol (collect endpoint)
  '**/collect?v=2**',

  // Google Sign-In One Tap — overlay intercepts pointer events on smaller viewports
  '**/accounts.google.com/gsi/**',
];
