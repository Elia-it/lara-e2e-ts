/**
 * Dev-only: preview the dashboard locally with mock data.
 *
 * Usage: npx tsx scripts/preview-dashboard.ts
 *
 * Generates .preview-dashboard.html with realistic mock entries
 * and opens it in the default browser.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

/* ------------------------------------------------------------------ */
/*  Mock data                                                          */
/* ------------------------------------------------------------------ */

interface DeviceResult {
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  durationMs?: number;
}

interface ManifestEntry {
  prefix: string;
  timestamp: string;
  branch: string;
  sha: string;
  status: string;
  url: string;
  devices?: Record<string, DeviceResult>;
  durationMs?: number;
}

const DEVICE_LABELS: Record<string, string> = {
  'desktop-chrome': 'Desktop Chrome',
  'desktop-safari': 'Desktop Safari',
  'desktop-firefox': 'Desktop Firefox',
  'desktop-edge': 'Desktop Edge',
  'mobile-iphone-15-pro': 'iPhone 15 Pro',
  'mobile-galaxy-s24': 'Galaxy S24',
  'tablet-ipad-air': 'iPad Air',
  'low-end-android': 'Low-end Android',
};

const RETENTION_DAYS = 31;

function randomSha(): string {
  return (
    Math.random().toString(16).substring(2, 16) +
    Math.random().toString(16).substring(2, 16)
  );
}

function mockDevices(failRate: number): Record<string, DeviceResult> {
  const devices: Record<string, DeviceResult> = {};
  const names = [
    'desktop-chrome',
    'desktop-safari',
    'desktop-firefox',
    'mobile-iphone-15-pro',
  ];

  for (const name of names) {
    const total = 12;
    const shouldFail = Math.random() < failRate;
    const failCount = shouldFail ? Math.floor(Math.random() * 3) + 1 : 0;
    const flakyCount = !shouldFail && Math.random() < 0.15 ? 1 : 0;

    devices[name] = {
      passed: total - failCount - flakyCount,
      failed: failCount,
      flaky: flakyCount,
      skipped: 0,
      durationMs: Math.floor(Math.random() * 60000) + 30000,
    };
  }

  return devices;
}

function generateEntries(
  count: number,
  scope: 'cron' | 'ci',
  failRate: number,
): ManifestEntry[] {
  const entries: ManifestEntry[] = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const hoursAgo =
      scope === 'cron'
        ? i * 6 + Math.random()
        : i * (Math.random() * 12 + 1);

    const ts = new Date(now - hoursAgo * 3_600_000);
    const sha = randomSha();
    const devices = mockDevices(failRate);
    const hasFailed = Object.values(devices).some((d) => d.failed > 0);
    const branches = ['main', 'feature/auth', 'fix/login-bug', 'feature/dashboard'];
    const branch = scope === 'cron' ? 'main' : branches[i % branches.length];

    entries.push({
      prefix: `${scope === 'cron' ? 'reports' : 'ci'}/${ts.toISOString()}_${branch}_${sha.substring(0, 7)}/`,
      timestamp: ts.toISOString(),
      branch,
      sha,
      status: hasFailed ? 'failed' : 'passed',
      url: '#',
      devices,
      durationMs: Math.max(...Object.values(devices).map((d) => d.durationMs || 0)),
    });
  }

  return entries;
}

/* ------------------------------------------------------------------ */
/*  Build HTML by extracting the template from upload-report.ts        */
/* ------------------------------------------------------------------ */

const cronEntries = generateEntries(120, 'cron', 0.12);
const ciEntries = generateEntries(25, 'ci', 0.2);

const uploadSrc = readFileSync(
  join(process.cwd(), 'scripts/upload-report.ts'),
  'utf-8',
);

// The template starts with `<!DOCTYPE html> and ends with </html>`
const tmplStart = uploadSrc.indexOf('`<!DOCTYPE html>');
const tmplEnd = uploadSrc.indexOf('</html>`', tmplStart) + '</html>`'.length;

if (tmplStart === -1 || tmplEnd === -1) {
  console.error('Could not find HTML template in upload-report.ts');
  process.exit(1);
}

// Strip surrounding backticks and interpolate mock data
const rawTemplate = uploadSrc.substring(tmplStart + 1, tmplEnd - 1);

function safeJsonForHtml(json: string): string {
  return json.replace(/<\//g, '<\\/');
}

const html = rawTemplate
  .replace('${cronJson}', safeJsonForHtml(JSON.stringify(cronEntries)))
  .replace('${ciJson}', safeJsonForHtml(JSON.stringify(ciEntries)))
  .replace('${deviceLabelsJson}', safeJsonForHtml(JSON.stringify(DEVICE_LABELS)))
  .replace('${RETENTION_DAYS}', String(RETENTION_DAYS))
  .replace('${generatedAt}', new Date().toISOString());

/* ------------------------------------------------------------------ */
/*  Write and open                                                     */
/* ------------------------------------------------------------------ */

const outPath = join(process.cwd(), '.preview-dashboard.html');
writeFileSync(outPath, html);
console.log(`Preview written to ${outPath}`);

try {
  if (process.platform === 'win32') {
    execSync(`cmd /c start "" "${outPath}"`);
  } else {
    const openCmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
    execSync(`${openCmd} "${outPath}"`);
  }
  console.log('Opened in browser.');
} catch {
  console.log(`Open manually: file://${outPath}`);
}
