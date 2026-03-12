import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const BUCKET = process.env.S3_BUCKET_NAME;
const REGION = process.env.AWS_REGION || 'eu-west-1';
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN;
const REPORT_DIR = join(process.cwd(), 'playwright-report');
const RESULTS_FILE = join(process.cwd(), 'test-results.json');
const RETENTION_DAYS = 31;
const UPLOAD_BATCH_SIZE = 20;

type Scope = 'ci' | 'cron';

/* ------------------------------------------------------------------ */
/*  CLI args                                                           */
/* ------------------------------------------------------------------ */

function parseArgs(): { status: string; scope: Scope } {
  const statusArg = process.argv.find((a) => a.startsWith('--status='));
  const status = statusArg?.split('=')[1] || 'unknown';

  const scopeArg = process.argv.find((a) => a.startsWith('--scope='));
  const scope = (scopeArg?.split('=')[1] || autoDetectScope()) as Scope;

  return { status, scope };
}

function autoDetectScope(): Scope {
  const event = process.env.GITHUB_EVENT_NAME;
  if (event === 'schedule') return 'cron';
  return 'ci';
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function gitValue(command: string): string {
  try {
    return execSync(command, { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.zip': 'application/zip',
  '.txt': 'text/plain',
};

function contentType(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function walkDir(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function buildBaseUrl(): string {
  const domain = CLOUDFRONT_DOMAIN || `${BUCKET}.s3.${REGION}.amazonaws.com`;
  return `https://${domain}`;
}

/* ------------------------------------------------------------------ */
/*  Playwright result parsing                                          */
/* ------------------------------------------------------------------ */

interface PlaywrightResult {
  suites: PlaywrightSuite[];
}

interface PlaywrightSuite {
  suites?: PlaywrightSuite[];
  specs?: PlaywrightSpec[];
}

interface PlaywrightSpec {
  tests: PlaywrightTest[];
}

interface PlaywrightTestResult {
  duration: number;
}

interface PlaywrightTest {
  projectName: string;
  status: string; // 'expected' | 'unexpected' | 'flaky' | 'skipped'
  results: PlaywrightTestResult[];
}

interface DeviceResult {
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  durationMs?: number;
}

function collectTests(suite: PlaywrightSuite): PlaywrightTest[] {
  const tests: PlaywrightTest[] = [];
  for (const spec of suite.specs || []) {
    tests.push(...spec.tests);
  }
  for (const child of suite.suites || []) {
    tests.push(...collectTests(child));
  }
  return tests;
}

function parseTestResults(): Record<string, DeviceResult> | undefined {
  try {
    if (!existsSync(RESULTS_FILE)) return undefined;
    const raw = readFileSync(RESULTS_FILE, 'utf-8');
    const report = JSON.parse(raw) as PlaywrightResult;

    const devices: Record<string, DeviceResult> = {};

    for (const suite of report.suites) {
      for (const test of collectTests(suite)) {
        const name = test.projectName || 'unknown';
        if (!devices[name]) {
          devices[name] = { passed: 0, failed: 0, flaky: 0, skipped: 0, durationMs: 0 };
        }
        switch (test.status) {
          case 'expected':
            devices[name].passed++;
            break;
          case 'unexpected':
            devices[name].failed++;
            break;
          case 'flaky':
            devices[name].flaky++;
            break;
          case 'skipped':
            devices[name].skipped++;
            break;
        }
        // Sum duration from the last result (final retry attempt)
        if (test.results && test.results.length > 0) {
          devices[name].durationMs! += test.results[test.results.length - 1].duration;
        }
      }
    }

    return Object.keys(devices).length > 0 ? devices : undefined;
  } catch {
    console.warn('Warning: Could not parse test-results.json, device data will be omitted.');
    return undefined;
  }
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

/* ------------------------------------------------------------------ */
/*  Manifest types                                                     */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  S3 operations                                                      */
/* ------------------------------------------------------------------ */

function createS3Client(): S3Client {
  return new S3Client({ region: REGION });
}

async function uploadFile(
  s3: S3Client,
  key: string,
  body: Buffer | string,
  type: string,
  cacheControl?: string,
): Promise<void> {
  const params: PutObjectCommandInput = {
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: type,
  };
  if (cacheControl) {
    params.CacheControl = cacheControl;
  }
  await s3.send(new PutObjectCommand(params));
}

async function downloadManifest(s3: S3Client, key: string): Promise<ManifestEntry[]> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    );
    const text = await res.Body?.transformToString();
    return text ? (JSON.parse(text) as ManifestEntry[]) : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Upload report files in parallel batches                            */
/* ------------------------------------------------------------------ */

async function uploadReportFiles(s3: S3Client, prefix: string): Promise<number> {
  const files = walkDir(REPORT_DIR);
  let uploaded = 0;

  for (let i = 0; i < files.length; i += UPLOAD_BATCH_SIZE) {
    const batch = files.slice(i, i + UPLOAD_BATCH_SIZE);
    await Promise.all(
      batch.map(async (filePath) => {
        const relativePath = relative(REPORT_DIR, filePath);
        const key = `${prefix}${relativePath}`;
        const body = readFileSync(filePath);
        await uploadFile(s3, key, body, contentType(filePath));
      }),
    );
    uploaded += batch.length;
  }

  return uploaded;
}

/* ------------------------------------------------------------------ */
/*  Dashboard HTML generation                                          */
/* ------------------------------------------------------------------ */

function safeJsonForHtml(json: string): string {
  return json.replace(/<\//g, '<\\/');
}

function generateDashboardHtml(
  cronEntries: ManifestEntry[],
  ciEntries: ManifestEntry[],
): string {
  const cronJson = safeJsonForHtml(JSON.stringify(cronEntries));
  const ciJson = safeJsonForHtml(JSON.stringify(ciEntries));
  const deviceLabelsJson = safeJsonForHtml(JSON.stringify(DEVICE_LABELS));
  const generatedAt = new Date().toISOString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="300">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Cpath fill='%234647B9' d='M20 2.823C29.486 2.823 37.177 10.514 37.177 20S29.486 37.177 20 37.177 2.823 29.486 2.823 20C2.835 10.518 10.518 2.835 20 2.823ZM20 0C8.955 0 0 8.955 0 20s8.955 20 20 20 20-8.955 20-20S31.042 0 20 0Z'/%3E%3Cpath fill='%234647B9' d='M25.556 16.487a2.103 2.103 0 1 0 0-4.206 2.103 2.103 0 0 0 0 4.206Z'/%3E%3Cpath fill='%234647B9' d='M13.645 29.183V11.258h3.122v15.07h8.975v2.851h-12.1v.004Z'/%3E%3C/svg%3E">
  <title>Lara E2E Status</title>
  <style>
    :root, [data-theme="light"] {
      --bg: #ffffff;
      --bg-secondary: #f3f5f7;
      --fg: #1f2328;
      --fg-muted: #59636e;
      --border: #d0d7de;
      --border-light: #dde2e7;
      --link: #0969da;
      --green: #1a7f37;
      --green-bg: #dafbe1;
      --green-bar: #2da44e;
      --red: #cf222e;
      --red-bg: #ffebe9;
      --red-bar: #cf222e;
      --yellow: #7d5600;
      --yellow-bg: #fff8c5;
      --yellow-bar: #d4960a;
      --gray-bar: #bcc3cc;
      --hover: #f3f4f6;
      --shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.08);
      --radius: 10px;
    }

    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {
        --bg: #0d1117;
        --bg-secondary: #161b22;
        --fg: #e6edf3;
        --fg-muted: #8b949e;
        --border: #30363d;
        --border-light: #21262d;
        --link: #58a6ff;
        --green: #3fb950;
        --green-bg: #0d2818;
        --green-bar: #238636;
        --red: #f85149;
        --red-bg: #3d1214;
        --red-bar: #da3633;
        --yellow: #d29922;
        --yellow-bg: #2e1f00;
        --yellow-bar: #9e6a03;
        --gray-bar: #30363d;
        --hover: #1c2128;
        --shadow: 0 1px 3px rgba(0,0,0,0.2);
      }
    }

    [data-theme="dark"] {
      --bg: #0d1117;
      --bg-secondary: #161b22;
      --fg: #e6edf3;
      --fg-muted: #8b949e;
      --border: #30363d;
      --border-light: #21262d;
      --link: #58a6ff;
      --green: #3fb950;
      --green-bg: #0d2818;
      --green-bar: #238636;
      --red: #f85149;
      --red-bg: #3d1214;
      --red-bar: #da3633;
      --yellow: #d29922;
      --yellow-bg: #2e1f00;
      --yellow-bar: #9e6a03;
      --gray-bar: #30363d;
      --hover: #1c2128;
      --shadow: 0 1px 3px rgba(0,0,0,0.2);
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    .container {
      max-width: 880px;
      margin: 0 auto;
      padding: 2.5rem 1.5rem;
    }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.25rem;
    }
    .header h1 {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .header-logo {
      height: 2.25rem;
      width: auto;
      flex-shrink: 0;
    }
    .header-brand-group {
      display: flex;
      flex-direction: column;
      line-height: 1;
    }
    .header-brand {
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.03em;
    }
    .header-byline {
      font-size: 0.625rem;
      font-weight: 400;
      color: var(--fg-muted);
      letter-spacing: 0.02em;
      margin-top: 0.125rem;
    }
    .header-separator {
      width: 1px;
      height: 1.75rem;
      background: var(--border);
      flex-shrink: 0;
    }
    .header-subtitle {
      font-size: 0.9375rem;
      font-weight: 500;
      color: var(--fg-muted);
      letter-spacing: 0;
    }
    .theme-switch {
      position: fixed;
      top: 1.25rem;
      right: 1.25rem;
      z-index: 100;
      cursor: pointer;
    }
    .theme-switch input { display: none; }
    .theme-switch-track {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 48px;
      height: 26px;
      padding: 0 6px;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 13px;
      transition: background 0.2s, border-color 0.2s;
    }
    .theme-switch:hover .theme-switch-track { border-color: var(--fg-muted); }
    .theme-switch-sun, .theme-switch-moon {
      font-size: 0.6875rem;
      line-height: 1;
      position: relative;
      z-index: 1;
    }
    .theme-switch-thumb {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 20px;
      height: 20px;
      background: var(--fg);
      border-radius: 50%;
      transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      opacity: 0.15;
    }
    .theme-switch input:checked + .theme-switch-track .theme-switch-thumb {
      transform: translateX(22px);
    }
    .header-meta {
      font-size: 0.75rem;
      color: var(--fg-muted);
    }

    /* Tabs */
    .tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--border);
      margin-bottom: 1.25rem;
    }
    .tab {
      padding: 0.625rem 1rem;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--fg-muted);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: color 0.15s, border-color 0.15s;
      user-select: none;
    }
    .tab:hover { color: var(--fg); }
    .tab.active {
      color: var(--fg);
      border-bottom-color: var(--link);
    }
    .tab-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.25rem;
      height: 1.25rem;
      padding: 0 0.375rem;
      margin-left: 0.375rem;
      font-size: 0.6875rem;
      font-weight: 600;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 10px;
    }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    /* Status banner */
    .status-banner {
      display: flex;
      align-items: center;
      gap: 0.875rem;
      padding: 1rem 1.25rem;
      border-radius: var(--radius);
      margin-bottom: 1.25rem;
      border: 1px solid var(--border-light);
    }
    .status-banner.operational {
      background: var(--green-bg);
      border-color: var(--green-bar);
    }
    .status-banner.degraded {
      background: var(--yellow-bg);
      border-color: var(--yellow-bar);
    }
    .status-banner.down {
      background: var(--red-bg);
      border-color: var(--red-bar);
    }
    .status-banner.empty {
      background: var(--bg-secondary);
    }
    .status-icon {
      font-size: 1.75rem;
      line-height: 1;
    }
    .status-text h2 {
      font-size: 1.125rem;
      font-weight: 600;
      line-height: 1.3;
    }
    .status-text p {
      font-size: 0.8125rem;
      color: var(--fg-muted);
    }

    /* Section headers */
    .section-header {
      font-size: 0.8125rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--fg-muted);
      margin-bottom: 0.75rem;
    }

    /* Uptime section */
    .uptime-section {
      margin-bottom: 1.5rem;
    }
    .device-uptime {
      padding: 1rem 0;
      border-bottom: 1px solid var(--border-light);
    }
    .device-uptime:last-child { border-bottom: none; }
    .device-uptime-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.5rem;
    }
    .device-name {
      font-size: 0.875rem;
      font-weight: 500;
    }
    .device-uptime-pct {
      font-size: 0.8125rem;
      font-weight: 600;
    }
    .uptime-bar {
      display: flex;
      gap: 2px;
      height: 32px;
    }
    .day-block {
      flex: 1;
      border-radius: 3px;
      cursor: pointer;
      position: relative;
      transition: opacity 0.1s, transform 0.1s;
      min-width: 0;
    }
    .uptime-bar:hover .day-block:not(.empty) { opacity: 0.35; }
    .uptime-bar:hover .day-block:not(.empty):hover { opacity: 1; transform: scaleY(1.1); }
    .day-block.passed { background: var(--green-bar); }
    .day-block.failed { background: var(--red-bar); }
    .day-block.mixed { background: var(--yellow-bar); }
    .day-block.empty { background: var(--gray-bar); opacity: 0.4; cursor: default; }
    .day-block.empty:hover { transform: none; }
    .uptime-legend {
      display: flex;
      justify-content: space-between;
      margin-top: 0.375rem;
      font-size: 0.6875rem;
      color: var(--fg-muted);
    }

    /* Tooltip */
    .tooltip {
      display: none;
      position: absolute;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      background: var(--fg);
      color: var(--bg);
      padding: 0.375rem 0.625rem;
      border-radius: 6px;
      font-size: 0.6875rem;
      white-space: nowrap;
      z-index: 10;
      pointer-events: none;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }
    .tooltip::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border: 5px solid transparent;
      border-top-color: var(--fg);
    }
    .day-block:hover .tooltip { display: block; }

    /* Day groups */
    .days-section { margin-bottom: 1.5rem; }
    .day-group {
      border: 1px solid var(--border-light);
      border-radius: var(--radius);
      margin-bottom: 0.625rem;
      overflow: hidden;
      transition: border-color 0.15s;
      scroll-margin-top: 1rem;
    }
    .day-group:hover { border-color: var(--border); }
    .day-group.highlight {
      border-color: var(--link);
      box-shadow: 0 0 0 1px var(--link);
    }
    .day-group-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.875rem 1.25rem;
      cursor: pointer;
      user-select: none;
    }
    .day-status-bar {
      width: 4px;
      height: 36px;
      border-radius: 2px;
      flex-shrink: 0;
    }
    .day-status-bar.passed { background: var(--green-bar); }
    .day-status-bar.failed { background: var(--red-bar); }
    .day-status-bar.mixed { background: var(--yellow-bar); }
    .day-info { flex: 1; min-width: 0; }
    .day-title {
      font-size: 0.9375rem;
      font-weight: 600;
    }
    .day-summary {
      font-size: 0.75rem;
      color: var(--fg-muted);
      margin-top: 0.125rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .day-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.1rem 0.5rem;
      border-radius: 10px;
      font-size: 0.6875rem;
      font-weight: 600;
    }
    .day-badge.ok { background: var(--green-bg); color: var(--green); }
    .day-badge.fail { background: var(--red-bg); color: var(--red); }
    .day-badge.flaky { background: var(--yellow-bg); color: var(--yellow); }
    .day-chevron {
      color: var(--fg-muted);
      font-size: 0.75rem;
      transition: transform 0.2s;
      flex-shrink: 0;
    }
    .day-group.expanded .day-chevron { transform: rotate(90deg); }
    .day-body {
      display: none;
      padding: 0 1.25rem 1rem;
      border-top: 1px solid var(--border-light);
    }
    .day-group.expanded .day-body { display: block; }

    /* Run cards (inside day groups) */
    .run-card {
      border: 1px solid var(--border-light);
      border-radius: 8px;
      margin-top: 0.75rem;
      overflow: hidden;
      background: var(--bg-secondary);
    }
    .run-header {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      padding: 0.75rem 1rem;
      cursor: pointer;
      user-select: none;
    }
    .run-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .run-status-dot.passed { background: var(--green-bar); }
    .run-status-dot.failed { background: var(--red-bar); }
    .run-status-dot.unknown { background: var(--gray-bar); }
    .run-info { flex: 1; min-width: 0; }
    .run-title {
      font-size: 0.8125rem;
      font-weight: 500;
    }
    .run-meta {
      font-size: 0.6875rem;
      color: var(--fg-muted);
      margin-top: 0.0625rem;
    }
    .run-meta code {
      background: var(--bg);
      padding: 0.1rem 0.3rem;
      border-radius: 3px;
      font-size: 0.65rem;
      border: 1px solid var(--border-light);
    }
    .run-actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-shrink: 0;
    }
    .run-link {
      font-size: 0.6875rem;
      color: var(--link);
      text-decoration: none;
      white-space: nowrap;
      padding: 0.25rem 0.625rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg);
      transition: background 0.1s;
    }
    .run-link:hover { background: var(--hover); text-decoration: none; }
    .run-chevron {
      color: var(--fg-muted);
      font-size: 0.6875rem;
      transition: transform 0.2s;
      flex-shrink: 0;
    }
    .run-card.expanded .run-chevron { transform: rotate(90deg); }
    .run-details {
      display: none;
      padding: 0 1rem 0.75rem;
      border-top: 1px solid var(--border-light);
    }
    .run-card.expanded .run-details { display: block; }
    .device-row {
      display: flex;
      align-items: center;
      padding: 0.4375rem 0;
      gap: 0.625rem;
      border-bottom: 1px solid var(--border-light);
    }
    .device-row:last-child { border-bottom: none; }
    .device-status-icon {
      width: 16px;
      text-align: center;
      flex-shrink: 0;
      font-size: 0.75rem;
    }
    .device-label {
      font-size: 0.8125rem;
      font-weight: 500;
      min-width: 130px;
    }
    .device-counts {
      font-size: 0.6875rem;
      color: var(--fg-muted);
    }
    .device-counts .failed-count { color: var(--red); font-weight: 600; }
    .device-counts .flaky-count { color: var(--yellow); }

    /* Device status grid */
    .status-grid {
      margin-bottom: 1.5rem;
    }
    .status-grid-cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 0.75rem;
    }
    .device-card {
      border: 1px solid var(--border-light);
      border-radius: var(--radius);
      padding: 1.125rem 1.25rem;
      transition: border-color 0.15s;
    }
    .device-card:hover { border-color: var(--border); }
    .device-card.up { border-left: 3px solid var(--green-bar); }
    .device-card.down { border-left: 3px solid var(--red-bar); }
    .device-card.flaky { border-left: 3px solid var(--yellow-bar); }
    .device-card.no-data { border-left: 3px solid var(--gray-bar); }
    .device-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.5rem;
    }
    .device-card-name {
      font-size: 0.8125rem;
      font-weight: 600;
    }
    .device-card-badge {
      font-size: 0.625rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.125rem 0.5rem;
      border-radius: 10px;
    }
    .device-card-badge.up { background: var(--green-bg); color: var(--green); }
    .device-card-badge.down { background: var(--red-bg); color: var(--red); }
    .device-card-badge.flaky { background: var(--yellow-bg); color: var(--yellow); }
    .device-card-badge.no-data { background: var(--bg-secondary); color: var(--fg-muted); }
    .device-card-counts {
      font-size: 0.75rem;
      color: var(--fg-muted);
      margin-bottom: 0.625rem;
    }
    .device-card-counts strong { color: var(--fg); }
    .device-card-counts .fail { color: var(--red); font-weight: 600; }
    .device-card-history {
      display: flex;
      gap: 3px;
      align-items: center;
    }
    .history-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .history-dot.passed { background: var(--green-bar); }
    .history-dot.failed { background: var(--red-bar); }
    .history-dot.mixed { background: var(--yellow-bar); }
    .history-dot.empty { background: var(--gray-bar); opacity: 0.35; }
    .history-label {
      font-size: 0.5625rem;
      color: var(--fg-muted);
      margin-left: 0.25rem;
      white-space: nowrap;
    }

    /* Empty state */
    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--fg-muted);
    }
    .empty-state p {
      font-size: 0.875rem;
    }

    /* (CI table styles removed — CI now uses branch-grouped cards) */

    /* Legend */
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-top: 0.75rem;
      margin-bottom: 0.25rem;
      font-size: 0.6875rem;
      color: var(--fg-muted);
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
    }
    .legend-dot {
      width: 10px;
      height: 10px;
      border-radius: 3px;
      flex-shrink: 0;
    }
    .legend-dot.green { background: var(--green-bar); }
    .legend-dot.red { background: var(--red-bar); }
    .legend-dot.yellow { background: var(--yellow-bar); }
    .legend-dot.gray { background: var(--gray-bar); opacity: 0.4; }

    /* Focus-visible for keyboard navigation */
    .day-group-header:focus-visible,
    .run-header:focus-visible,
    .tab:focus-visible {
      outline: 2px solid var(--link);
      outline-offset: -2px;
    }

    /* Toggle all button */
    .toggle-all-btn {
      font-size: 0.6875rem;
      color: var(--link);
      background: none;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.25rem 0.625rem;
      cursor: pointer;
      font-weight: 500;
      font-family: inherit;
    }
    .toggle-all-btn:hover { background: var(--hover); }

    /* CI branch groups (reuse day-group expand pattern) */
    .ci-branch-group {
      border: 1px solid var(--border-light);
      border-radius: var(--radius);
      margin-bottom: 0.625rem;
      overflow: hidden;
      transition: border-color 0.15s;
    }
    .ci-branch-group:hover { border-color: var(--border); }
    .ci-branch-group .day-body { display: none; }
    .ci-branch-group.expanded .day-body { display: block; }
    .ci-branch-group .day-chevron { transition: transform 0.2s; }
    .ci-branch-group.expanded .day-chevron { transform: rotate(90deg); }

    /* CI filter input */
    #ci-filter {
      width: 100%;
      max-width: 300px;
      padding: 0.5rem 0.75rem;
      font-size: 0.8125rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg);
      color: var(--fg);
      outline: none;
      font-family: inherit;
    }
    #ci-filter:focus { border-color: var(--link); box-shadow: 0 0 0 2px color-mix(in srgb, var(--link) 20%, transparent); }
    #ci-filter::placeholder { color: var(--fg-muted); }

    /* CI expandable rows */
    .ci-chevron {
      font-size: 0.6875rem;
      color: var(--fg-muted);
      transition: transform 0.2s;
      display: inline-block;
    }
    .ci-chevron.expanded { transform: rotate(90deg); }
    .ci-row.expandable { cursor: pointer; }
    .ci-detail-row td { padding: 0; }
    .ci-detail-content {
      padding: 0.5rem 1rem 0.75rem 2rem;
    }

    /* Drill-down divider */
    .drilldown-divider {
      border: none;
      border-top: 1px dashed var(--border);
      margin: 1.5rem 0 1rem;
    }

    /* Collapsible section */
    .collapsible-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      user-select: none;
      margin-bottom: 0.75rem;
    }
    .collapsible-header:hover .section-header { color: var(--fg); }
    .collapsible-header .section-header { margin-bottom: 0; transition: color 0.15s; }
    .collapsible-chevron {
      font-size: 0.75rem;
      color: var(--fg-muted);
      transition: transform 0.2s;
    }
    .collapsible-section.collapsed .collapsible-body { display: none; }
    .collapsible-section.collapsed .collapsible-chevron { transform: rotate(0deg); }
    .collapsible-section .collapsible-chevron { transform: rotate(90deg); }

    /* Failures section */
    .failures-section { margin-bottom: 1.5rem; }
    .failure-device {
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--border-light);
    }
    .failure-device:last-child { border-bottom: none; }
    .failure-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.375rem;
    }
    .failure-name { font-size: 0.875rem; font-weight: 500; }
    .failure-ratio { font-size: 0.75rem; color: var(--red); font-weight: 600; }
    .failure-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.6875rem;
    }
    .failure-table td {
      padding: 0.25rem 0;
      color: var(--fg-muted);
    }
    .failure-date { width: auto; }
    .failure-date a { color: var(--link); text-decoration: none; }
    .failure-date a:hover { text-decoration: underline; }
    .failure-count { text-align: right; white-space: nowrap; }
    .failure-count .failed-count { color: var(--red); font-weight: 600; }
    .failure-more { color: var(--fg-muted); padding-top: 0.125rem; }

    /* Duration */
    .run-duration {
      font-size: 0.6875rem;
      color: var(--fg-muted);
      white-space: nowrap;
    }
    .duration-trend {
      font-size: 0.625rem;
      font-weight: 600;
      margin-left: 0.25rem;
    }

    /* Responsive */
    @media (max-width: 640px) {
      .container { padding: 1.5rem 1rem; }
      .day-group-header { padding: 0.75rem 1rem; }
      .run-header { padding: 0.625rem 0.75rem; }
      .device-label { min-width: 100px; }
      .uptime-bar { height: 24px; }
      .day-body { padding: 0 0.75rem 0.75rem; }
      .status-grid-cards { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1><svg class="header-logo" viewBox="0 0 40 40" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M20 2.82339C29.4861 2.82339 37.1766 10.5139 37.1766 20C37.1766 29.4861 29.4861 37.1766 20 37.1766C10.5139 37.1766 2.82339 29.4861 2.82339 20C2.8352 10.5178 10.5178 2.8352 20 2.82339ZM20 0C8.95451 0 0 8.95452 0 20C0 31.0455 8.95451 40 20 40C31.0455 40 40 31.0455 40 20C40 8.95452 31.0415 0 20 0Z"/><path d="M25.5559 16.4868C26.7172 16.4868 27.6587 15.5454 27.6587 14.384C27.6587 13.2227 26.7172 12.2812 25.5559 12.2812C24.3946 12.2812 23.4531 13.2227 23.4531 14.384C23.4531 15.5454 24.3946 16.4868 25.5559 16.4868Z"/><path d="M13.6445 29.1826V11.2578H16.7672V26.3277H25.7414V29.1787H13.6445V29.1826Z"/></svg><span class="header-brand-group"><span class="header-brand">Lara</span><span class="header-byline">by translated.</span></span><span class="header-separator"></span><span class="header-subtitle">E2E Status</span></h1>
      <span class="header-meta">Updated <time id="generated-at">${generatedAt}</time> &middot; Auto-refreshes every 5 min</span>
    </div>

    <div class="tabs">
      <div class="tab active" data-tab="schedule" tabindex="0" role="button">Schedule<span class="tab-count" id="schedule-count">0</span></div>
      <div class="tab" data-tab="ci" tabindex="0" role="button">CI<span class="tab-count" id="ci-count">0</span></div>
    </div>

    <div class="tab-panel active" id="panel-schedule"></div>
    <div class="tab-panel" id="panel-ci"></div>
  </div>

  <label class="theme-switch" aria-label="Toggle theme">
    <input type="checkbox" id="theme-checkbox" onchange="toggleTheme(this.checked)">
    <span class="theme-switch-track">
      <span class="theme-switch-sun">&#x2600;&#xFE0E;</span>
      <span class="theme-switch-moon">&#x263E;</span>
      <span class="theme-switch-thumb"></span>
    </span>
  </label>

  <script type="application/json" id="data-cron">${cronJson}</script>
  <script type="application/json" id="data-ci">${ciJson}</script>
  <script type="application/json" id="data-devices">${deviceLabelsJson}</script>
  <script>
    var CRON_DATA = JSON.parse(document.getElementById('data-cron').textContent);
    var CI_DATA = JSON.parse(document.getElementById('data-ci').textContent);
    var DEVICE_LABELS = JSON.parse(document.getElementById('data-devices').textContent);
    var RETENTION_DAYS = ${RETENTION_DAYS};

    function esc(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    function formatDate(iso) {
      return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    }

    function formatWeekday(iso) {
      return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    }

    function formatTime(iso) {
      return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    }

    function timeAgo(iso) {
      var diff = Date.now() - new Date(iso).getTime();
      var mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + ' min ago';
      var hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      return Math.floor(hrs / 24) + 'd ago';
    }

    function deviceLabel(key) {
      return DEVICE_LABELS[key] || key;
    }

    function isToday(dateStr) {
      return dateStr === new Date().toISOString().substring(0, 10);
    }

    function formatDuration(ms) {
      if (!ms) return '';
      var secs = Math.floor(ms / 1000);
      if (secs < 60) return secs + 's';
      var mins = Math.floor(secs / 60);
      secs = secs % 60;
      return mins + 'm ' + (secs > 0 ? secs + 's' : '');
    }

    function durationTrend(currentMs, entries, entryIndex) {
      if (!currentMs) return '';
      var durations = [];
      for (var i = entryIndex + 1; i < entries.length && durations.length < 5; i++) {
        if (entries[i].durationMs) durations.push(entries[i].durationMs);
      }
      if (durations.length === 0) return '';
      var avg = 0;
      for (var i = 0; i < durations.length; i++) avg += durations[i];
      avg /= durations.length;
      var diff = ((currentMs - avg) / avg) * 100;
      if (Math.abs(diff) < 10) return '';
      var arrow = diff > 0 ? '&#x25B2;' : '&#x25BC;';
      var color = diff > 0 ? 'var(--red)' : 'var(--green)';
      return ' <span class="duration-trend" style="color:' + color + '">' + arrow + ' ' + Math.abs(Math.round(diff)) + '%</span>';
    }

    /* ---- Group entries by YYYY-MM-DD ---- */
    function groupByDay(entries) {
      var groups = {};
      var order = [];
      for (var i = 0; i < entries.length; i++) {
        var day = entries[i].timestamp.substring(0, 10);
        if (!groups[day]) { groups[day] = []; order.push(day); }
        groups[day].push(entries[i]);
      }
      return { groups: groups, order: order };
    }

    /* ---- Aggregate day status ---- */
    function dayStatus(runs) {
      var totalFailed = 0, totalFlaky = 0, totalPassed = 0;
      for (var i = 0; i < runs.length; i++) {
        if (runs[i].devices) {
          var devs = Object.values(runs[i].devices);
          for (var j = 0; j < devs.length; j++) {
            totalFailed += devs[j].failed;
            totalFlaky  += devs[j].flaky;
            totalPassed += devs[j].passed;
          }
        } else {
          if (runs[i].status === 'failed') totalFailed++;
          else totalPassed++;
        }
      }
      return { failed: totalFailed, flaky: totalFlaky, passed: totalPassed };
    }

    /* ---- Status banner ---- */
    function renderStatusBanner(entries) {
      if (entries.length === 0) {
        return '<div class="status-banner empty"><span class="status-icon">&#x2014;</span><div class="status-text"><h2>No Data Yet</h2><p>Waiting for the first scheduled run.</p></div></div>';
      }
      var latest = entries[0];
      var allPassed = latest.status === 'passed';
      var cls = allPassed ? 'operational' : 'down';
      var icon = allPassed ? '&#x2705;' : '&#x1F6A8;';

      /* Build a specific failure summary from device data */
      var title, detail = '';
      if (allPassed) {
        title = 'All Systems Operational';
      } else if (latest.devices) {
        var failedDevices = [];
        var totalFailed = 0;
        var devKeys = Object.keys(latest.devices);
        for (var i = 0; i < devKeys.length; i++) {
          var r = latest.devices[devKeys[i]];
          if (r.failed > 0) {
            failedDevices.push(deviceLabel(devKeys[i]));
            totalFailed += r.failed;
          }
        }
        title = totalFailed + ' test' + (totalFailed > 1 ? 's' : '') + ' failing';
        detail = ' on ' + esc(failedDevices.join(', '));
      } else {
        title = 'Issues Detected';
      }

      var sub = 'Last run ' + timeAgo(latest.timestamp) + ' &middot; ' + esc(formatDate(latest.timestamp)) + ' ' + esc(formatTime(latest.timestamp)) + ' UTC';
      return '<div class="status-banner ' + cls + '"><span class="status-icon">' + icon + '</span><div class="status-text"><h2>' + title + '<span style="font-weight:400;font-size:0.875rem;color:var(--fg-muted)">' + detail + '</span></h2><p>' + sub + '</p></div></div>';
    }

    /* ---- Device status grid ---- */
    function renderDeviceGrid(entries) {
      /* Find the latest entry that has device data */
      var latest = null;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].devices && Object.keys(entries[i].devices).length > 0) {
          latest = entries[i]; break;
        }
      }
      if (!latest) return '';

      /* Build per-device history from last 10 runs */
      var allDevices = Object.keys(latest.devices);
      var history = {};
      for (var d = 0; d < allDevices.length; d++) history[allDevices[d]] = [];
      for (var i = 0; i < Math.min(entries.length, 10); i++) {
        var e = entries[i];
        for (var d = 0; d < allDevices.length; d++) {
          var dev = allDevices[d];
          if (e.devices && e.devices[dev]) {
            var r = e.devices[dev];
            history[dev].push(r.failed > 0 ? 'failed' : r.flaky > 0 ? 'mixed' : 'passed');
          } else {
            history[dev].push('empty');
          }
        }
      }

      var html = '<div class="status-grid"><div class="section-header">Current Status</div><div class="status-grid-cards">';

      for (var d = 0; d < allDevices.length; d++) {
        var dev = allDevices[d];
        var r = latest.devices[dev];
        var total = r.passed + r.failed + r.flaky + r.skipped;
        var cardCls, badgeCls, badgeText;

        if (r.failed > 0) {
          cardCls = 'down'; badgeCls = 'down'; badgeText = 'Down';
        } else if (r.flaky > 0) {
          cardCls = 'flaky'; badgeCls = 'flaky'; badgeText = 'Flaky';
        } else {
          cardCls = 'up'; badgeCls = 'up'; badgeText = 'Operational';
        }

        /* Counts line */
        var countsHtml = '<strong>' + r.passed + '/' + total + '</strong> passed';
        if (r.failed > 0) countsHtml += ' &middot; <span class="fail">' + r.failed + ' failed</span>';
        if (r.flaky > 0) countsHtml += ' &middot; ' + r.flaky + ' flaky';

        /* History dots (reversed so oldest is left, newest is right) */
        var dots = '';
        var hist = history[dev];
        for (var h = hist.length - 1; h >= 0; h--) {
          dots += '<span class="history-dot ' + hist[h] + '"></span>';
        }

        html += '<div class="device-card ' + cardCls + '">';
        html += '<div class="device-card-header">';
        html += '<span class="device-card-name">' + esc(deviceLabel(dev)) + '</span>';
        html += '<span class="device-card-badge ' + badgeCls + '">' + badgeText + '</span>';
        html += '</div>';
        html += '<div class="device-card-counts">' + countsHtml + '</div>';
        html += '<div class="device-card-history">' + dots + '<span class="history-label">last ' + hist.length + ' runs</span></div>';
        html += '</div>';
      }

      html += '</div>';
      html += '<div class="legend">';
      html += '<span class="legend-item"><span class="legend-dot green"></span>Operational &mdash; all tests passed</span>';
      html += '<span class="legend-item"><span class="legend-dot yellow"></span>Flaky &mdash; tests passed on retry</span>';
      html += '<span class="legend-item"><span class="legend-dot red"></span>Down &mdash; one or more tests failed</span>';
      html += '</div>';
      html += '</div>';
      return html;
    }

    /* ---- Uptime bars ---- */
    function buildDayMap(entries) {
      var map = {};
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry.devices) continue;
        var day = entry.timestamp.substring(0, 10);
        var devKeys = Object.keys(entry.devices);
        for (var j = 0; j < devKeys.length; j++) {
          var dev = devKeys[j], result = entry.devices[dev];
          if (!map[dev]) map[dev] = {};
          if (!map[dev][day]) map[dev][day] = { passed: 0, failed: 0, flaky: 0 };
          map[dev][day].passed += result.passed;
          map[dev][day].failed += result.failed;
          map[dev][day].flaky  += result.flaky;
        }
      }
      return map;
    }

    function buildDaysList() {
      var days = [];
      var now = new Date();
      for (var i = RETENTION_DAYS - 1; i >= 0; i--) {
        var d = new Date(now);
        d.setUTCDate(d.getUTCDate() - i);
        days.push(d.toISOString().substring(0, 10));
      }
      return days;
    }

    function renderUptimeBars(entries) {
      var dayMap = buildDayMap(entries);
      var devices = Object.keys(dayMap);
      if (devices.length === 0) return '';

      var days = buildDaysList();
      var html = '<div class="uptime-section"><div class="section-header">Uptime &middot; Last ' + RETENTION_DAYS + ' days</div>';
      html += '<div class="legend">';
      html += '<span class="legend-item"><span class="legend-dot green"></span>All passed</span>';
      html += '<span class="legend-item"><span class="legend-dot yellow"></span>Flaky</span>';
      html += '<span class="legend-item"><span class="legend-dot red"></span>Failed</span>';
      html += '<span class="legend-item"><span class="legend-dot gray"></span>No runs</span>';
      html += '</div>';

      for (var di = 0; di < devices.length; di++) {
        var dev = devices[di];
        var data = dayMap[dev];
        var totalRuns = 0, passedRuns = 0;
        var bars = '';

        for (var k = 0; k < days.length; k++) {
          var day = days[k];
          var d = data[day];
          if (!d) {
            bars += '<div class="day-block empty" data-day="' + day + '"><div class="tooltip">' + esc(formatDate(day + 'T00:00:00Z')) + ' &mdash; No runs</div></div>';
          } else {
            totalRuns++;
            var hasFailed = d.failed > 0;
            var hasFlaky = d.flaky > 0 && !hasFailed;
            var cls = 'passed';
            if (hasFailed) cls = 'failed';
            else if (hasFlaky) cls = 'mixed';
            if (!hasFailed) passedRuns++;
            var tip = esc(formatDate(day + 'T00:00:00Z')) + ' &mdash; ' + d.passed + ' passed' + (d.failed ? ', ' + d.failed + ' failed' : '') + (d.flaky ? ', ' + d.flaky + ' flaky' : '') + '  (click to view)';
            bars += '<div class="day-block ' + cls + '" data-day="' + day + '" onclick="scrollToDay(this.dataset.day)"><div class="tooltip">' + tip + '</div></div>';
          }
        }

        var pct = totalRuns > 0 ? ((passedRuns / totalRuns) * 100).toFixed(1) : '---';
        var pctDisplay = pct === '---' ? 'N/A' : pct + '%';
        var pctNum = parseFloat(pct);
        var pctColor = pct === '---' ? 'var(--fg-muted)' : pctNum >= 100 ? 'var(--green)' : pctNum >= 90 ? 'var(--yellow)' : 'var(--red)';

        html += '<div class="device-uptime">';
        html += '<div class="device-uptime-header"><span class="device-name">' + esc(deviceLabel(dev)) + '</span><span class="device-uptime-pct" style="color:' + pctColor + '">' + pctDisplay + '</span></div>';
        html += '<div class="uptime-bar">' + bars + '</div>';
        html += '<div class="uptime-legend"><span>' + esc(formatDate(days[0] + 'T00:00:00Z')) + '</span><span>Today</span></div>';
        html += '</div>';
      }

      html += '</div>';
      return html;
    }

    /* ---- Day-grouped run cards ---- */
    function renderDayGroups(entries) {
      if (entries.length === 0) {
        return '<div class="empty-state"><p>No reports yet.</p></div>';
      }

      var grouped = groupByDay(entries);
      var html = '<div class="days-section collapsible-section collapsed">';
      html += '<div class="collapsible-header" onclick="toggleCollapsible(this)" tabindex="0" role="button"><div class="section-header">Run History</div><span class="collapsible-chevron">&#x25B6;</span></div>';
      html += '<div class="collapsible-body">';
      html += '<div style="display:flex;justify-content:flex-end;margin-bottom:0.75rem"><button class="toggle-all-btn" onclick="toggleAllDays(this)">Expand all</button></div>';

      for (var gi = 0; gi < grouped.order.length; gi++) {
        var day = grouped.order[gi];
        var runs = grouped.groups[day];
        var stat = dayStatus(runs);
        var barCls = stat.failed > 0 ? 'failed' : stat.flaky > 0 ? 'mixed' : 'passed';
        var dateLabel = isToday(day) ? 'Today' : esc(formatWeekday(day + 'T00:00:00Z')) + ', ' + esc(formatDate(day + 'T00:00:00Z'));

        /* Day summary badges */
        var badges = '';
        if (stat.failed > 0) badges += '<span class="day-badge fail">' + stat.failed + ' failed</span>';
        if (stat.flaky > 0) badges += '<span class="day-badge flaky">' + stat.flaky + ' flaky</span>';
        if (stat.passed > 0) badges += '<span class="day-badge ok">' + stat.passed + ' passed</span>';
        badges += '<span style="color:var(--fg-muted)">&middot; ' + runs.length + ' run' + (runs.length > 1 ? 's' : '') + '</span>';

        html += '<div class="day-group" id="day-' + day + '">';
        html += '<div class="day-group-header" tabindex="0" role="button" onclick="toggleDay(this)">';
        html += '<div class="day-status-bar ' + barCls + '"></div>';
        html += '<div class="day-info"><div class="day-title">' + dateLabel + '</div>';
        html += '<div class="day-summary">' + badges + '</div></div>';
        html += '<span class="day-chevron">&#x25B6;</span>';
        html += '</div>';

        html += '<div class="day-body">';
        for (var ri = 0; ri < runs.length; ri++) {
          var e = runs[ri];
          var dotCls = e.status === 'passed' ? 'passed' : e.status === 'failed' ? 'failed' : 'unknown';
          var timeStr = esc(formatTime(e.timestamp)) + ' UTC';
          var sha = esc(e.sha.substring(0, 7));
          var hasDevices = e.devices && Object.keys(e.devices).length > 0;

          /* Find global index for duration trend */
          var globalIdx = 0;
          for (var gii = 0; gii < entries.length; gii++) { if (entries[gii] === e) { globalIdx = gii; break; } }
          var durStr = e.durationMs ? formatDuration(e.durationMs) + durationTrend(e.durationMs, entries, globalIdx) : '';

          html += '<div class="run-card">';
          html += '<div class="run-header" tabindex="0" role="button" onclick="toggleRun(this)">';
          html += '<span class="run-status-dot ' + dotCls + '"></span>';
          html += '<div class="run-info"><div class="run-title">' + timeStr + (durStr ? ' <span class="run-duration">&middot; ' + durStr + '</span>' : '') + '</div>';
          html += '<div class="run-meta"><code>' + esc(e.branch) + '</code> &middot; <code>' + sha + '</code></div></div>';
          html += '<div class="run-actions">';
          html += '<a class="run-link" href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">View Report</a>';
          if (hasDevices) html += '<span class="run-chevron">&#x25B6;</span>';
          html += '</div>';
          html += '</div>';

          if (hasDevices) {
            html += '<div class="run-details">';
            var devKeys = Object.keys(e.devices);
            for (var di = 0; di < devKeys.length; di++) {
              var dev = devKeys[di], r = e.devices[dev];
              var hasFailed = r.failed > 0;
              var icon = hasFailed ? '&#x2716;' : '&#x2714;';
              var iconColor = hasFailed ? 'var(--red)' : 'var(--green)';
              var counts = r.passed + ' passed';
              if (r.failed) counts += ', <span class="failed-count">' + r.failed + ' failed</span>';
              if (r.flaky) counts += ', <span class="flaky-count">' + r.flaky + ' flaky</span>';
              if (r.skipped) counts += ', ' + r.skipped + ' skipped';
              if (r.durationMs) counts += ' &middot; ' + formatDuration(r.durationMs);

              html += '<div class="device-row">';
              html += '<span class="device-status-icon" style="color:' + iconColor + '">' + icon + '</span>';
              html += '<span class="device-label">' + esc(deviceLabel(dev)) + '</span>';
              html += '<span class="device-counts">' + counts + '</span>';
              html += '</div>';
            }
            html += '</div>';
          }

          html += '</div>';
        }
        html += '</div></div>';
      }

      html += '</div></div>';
      return html;
    }

    /* ---- CI: group entries by branch ---- */
    function groupByBranch(entries) {
      var groups = {};
      var order = [];
      for (var i = 0; i < entries.length; i++) {
        var branch = entries[i].branch;
        if (!groups[branch]) { groups[branch] = []; order.push(branch); }
        groups[branch].push(entries[i]);
      }
      return { groups: groups, order: order };
    }

    /* ---- CI summary ---- */
    function renderCiSummary(entries) {
      if (entries.length === 0) return '';
      var branches = {};
      for (var i = 0; i < entries.length; i++) branches[entries[i].branch] = true;
      var branchCount = Object.keys(branches).length;
      var passCount = 0;
      for (var i = 0; i < entries.length; i++) { if (entries[i].status === 'passed') passCount++; }
      var failCount = entries.length - passCount;
      var summary = entries.length + ' run' + (entries.length > 1 ? 's' : '') + ' across ' + branchCount + ' branch' + (branchCount > 1 ? 'es' : '');
      if (failCount > 0) summary += ' &middot; <span style="color:var(--red);font-weight:600">' + failCount + ' failed</span>';
      return '<div style="font-size:0.8125rem;color:var(--fg-muted);margin-bottom:1.25rem">' + summary + '</div>';
    }

    /* ---- CI grouped view ---- */
    function renderCiGroups(entries) {
      if (entries.length === 0) {
        return '<div class="empty-state"><p>No CI reports yet.</p></div>';
      }

      var html = '<div style="margin-bottom:0.75rem"><input type="text" id="ci-filter" placeholder="Filter by branch..." oninput="filterCiBranches()" /></div>';

      var grouped = groupByBranch(entries);

      for (var gi = 0; gi < grouped.order.length; gi++) {
        var branch = grouped.order[gi];
        var runs = grouped.groups[branch];
        var latestStatus = runs[0].status;
        var barCls = latestStatus === 'passed' ? 'passed' : 'failed';
        var passedRuns = 0;
        for (var ri = 0; ri < runs.length; ri++) { if (runs[ri].status === 'passed') passedRuns++; }

        html += '<div class="ci-branch-group' + (gi === 0 ? ' expanded' : '') + '" data-branch="' + esc(branch) + '">';
        html += '<div class="day-group-header" tabindex="0" role="button" onclick="this.parentElement.classList.toggle(\'expanded\')">';
        html += '<div class="day-status-bar ' + barCls + '"></div>';
        html += '<div class="day-info"><div class="day-title"><code style="font-size:0.9375rem">' + esc(branch) + '</code></div>';
        html += '<div class="day-summary">';
        if (runs.length - passedRuns > 0) html += '<span class="day-badge fail">' + (runs.length - passedRuns) + ' failed</span>';
        if (passedRuns > 0) html += '<span class="day-badge ok">' + passedRuns + ' passed</span>';
        html += '<span style="color:var(--fg-muted)">&middot; ' + runs.length + ' run' + (runs.length > 1 ? 's' : '') + '</span>';
        html += '</div></div>';
        html += '<span class="day-chevron">&#x25B6;</span>';
        html += '</div>';

        html += '<div class="day-body">';
        for (var ri = 0; ri < runs.length; ri++) {
          var e = runs[ri];
          var dotCls = e.status === 'passed' ? 'passed' : e.status === 'failed' ? 'failed' : 'unknown';
          var timeStr = esc(formatTime(e.timestamp)) + ' UTC';
          var dateStr = esc(formatDate(e.timestamp));
          var sha = esc(e.sha.substring(0, 7));
          var hasDevices = e.devices && Object.keys(e.devices).length > 0;
          var durStr = e.durationMs ? formatDuration(e.durationMs) : '';

          html += '<div class="run-card">';
          html += '<div class="run-header" tabindex="0" role="button" onclick="toggleRun(this)">';
          html += '<span class="run-status-dot ' + dotCls + '"></span>';
          html += '<div class="run-info"><div class="run-title">' + dateStr + ', ' + timeStr + (durStr ? ' <span class="run-duration">&middot; ' + durStr + '</span>' : '') + '</div>';
          html += '<div class="run-meta"><code>' + sha + '</code></div></div>';
          html += '<div class="run-actions">';
          html += '<a class="run-link" href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">View Report</a>';
          if (hasDevices) html += '<span class="run-chevron">&#x25B6;</span>';
          html += '</div>';
          html += '</div>';

          if (hasDevices) {
            html += '<div class="run-details">';
            var devKeys = Object.keys(e.devices);
            for (var di = 0; di < devKeys.length; di++) {
              var dev = devKeys[di], r = e.devices[dev];
              var devFailed = r.failed > 0;
              var devIcon = devFailed ? '&#x2716;' : '&#x2714;';
              var devIconColor = devFailed ? 'var(--red)' : 'var(--green)';
              var devCounts = r.passed + ' passed';
              if (r.failed) devCounts += ', <span class="failed-count">' + r.failed + ' failed</span>';
              if (r.flaky) devCounts += ', <span class="flaky-count">' + r.flaky + ' flaky</span>';
              if (r.skipped) devCounts += ', ' + r.skipped + ' skipped';
              if (r.durationMs) devCounts += ' &middot; ' + formatDuration(r.durationMs);

              html += '<div class="device-row">';
              html += '<span class="device-status-icon" style="color:' + devIconColor + '">' + devIcon + '</span>';
              html += '<span class="device-label">' + esc(deviceLabel(dev)) + '</span>';
              html += '<span class="device-counts">' + devCounts + '</span>';
              html += '</div>';
            }
            html += '</div>';
          }

          html += '</div>';
        }
        html += '</div></div>';
      }

      return html;
    }

    /* ---- Recent Failures ---- */
    function renderRecentFailures(entries) {
      var cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() - 7);
      var deviceFailures = {};

      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (new Date(e.timestamp) < cutoff) continue;
        if (!e.devices) continue;
        var devKeys = Object.keys(e.devices);
        for (var j = 0; j < devKeys.length; j++) {
          var dev = devKeys[j], r = e.devices[dev];
          if (r.failed > 0) {
            if (!deviceFailures[dev]) deviceFailures[dev] = [];
            deviceFailures[dev].push({
              failed: r.failed,
              total: r.passed + r.failed + r.flaky + r.skipped,
              url: e.url,
              time: e.timestamp
            });
          }
        }
      }

      var failDevices = Object.keys(deviceFailures);
      if (failDevices.length === 0) return '';

      /* Count total runs per device in the window */
      var totalRunsPerDevice = {};
      for (var i = 0; i < entries.length; i++) {
        if (new Date(entries[i].timestamp) < cutoff) continue;
        if (!entries[i].devices) continue;
        var dk = Object.keys(entries[i].devices);
        for (var j = 0; j < dk.length; j++) {
          totalRunsPerDevice[dk[j]] = (totalRunsPerDevice[dk[j]] || 0) + 1;
        }
      }

      var html = '<div class="failures-section collapsible-section collapsed">';
      html += '<div class="collapsible-header" onclick="toggleCollapsible(this)" tabindex="0" role="button"><div class="section-header">Recent Failures &middot; Last 7 days</div><span class="collapsible-chevron">&#x25B6;</span></div>';
      html += '<div class="collapsible-body">';

      for (var d = 0; d < failDevices.length; d++) {
        var dev = failDevices[d];
        var fails = deviceFailures[dev];
        var totalRuns = totalRunsPerDevice[dev] || fails.length;

        html += '<div class="failure-device">';
        html += '<div class="failure-header">';
        html += '<span class="failure-name">' + esc(deviceLabel(dev)) + '</span>';
        html += '<span class="failure-ratio">Failed in ' + fails.length + '/' + totalRuns + ' runs</span>';
        html += '</div>';
        html += '<table class="failure-table"><tbody>';
        var showCount = Math.min(fails.length, 5);
        for (var f = 0; f < showCount; f++) {
          html += '<tr>';
          html += '<td class="failure-date"><a href="' + esc(fails[f].url) + '" target="_blank" rel="noopener noreferrer">' + esc(formatDate(fails[f].time)) + ', ' + esc(formatTime(fails[f].time)) + '</a></td>';
          html += '<td class="failure-count"><span class="failed-count">' + fails[f].failed + '</span> / ' + fails[f].total + ' failed</td>';
          html += '</tr>';
        }
        if (fails.length > 5) {
          html += '<tr><td colspan="2" class="failure-more">+' + (fails.length - 5) + ' more</td></tr>';
        }
        html += '</tbody></table>';
        html += '</div>';
      }

      html += '</div></div>';
      return html;
    }

    /* ---- CI filter ---- */
    function filterCiBranches() {
      var query = document.getElementById('ci-filter').value.toLowerCase();
      var groups = document.querySelectorAll('.ci-branch-group');
      for (var i = 0; i < groups.length; i++) {
        var branch = (groups[i].getAttribute('data-branch') || '').toLowerCase();
        groups[i].style.display = branch.indexOf(query) !== -1 ? '' : 'none';
      }
    }

    /* ---- Tab switching ---- */
    document.querySelectorAll('.tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
        document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
        tab.classList.add('active');
        document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
        updateHash();
      });
    });

    /* ---- Toggle day group ---- */
    function toggleDay(header) {
      header.parentElement.classList.toggle('expanded');
      updateHash();
    }

    /* ---- Toggle run details ---- */
    function toggleRun(header) {
      header.parentElement.classList.toggle('expanded');
    }

    /* ---- Toggle all day groups ---- */
    /* ---- Toggle collapsible sections ---- */
    function toggleCollapsible(header) {
      header.parentElement.classList.toggle('collapsed');
    }

    function toggleAllDays(btn) {
      var groups = document.querySelectorAll('.day-group');
      var anyCollapsed = false;
      for (var i = 0; i < groups.length; i++) {
        if (!groups[i].classList.contains('expanded')) { anyCollapsed = true; break; }
      }
      for (var i = 0; i < groups.length; i++) {
        if (anyCollapsed) groups[i].classList.add('expanded');
        else groups[i].classList.remove('expanded');
      }
      btn.textContent = anyCollapsed ? 'Collapse all' : 'Expand all';
      updateHash();
    }

    /* ---- Scroll to day from uptime bar click ---- */
    function scrollToDay(day) {
      var el = document.getElementById('day-' + day);
      if (!el) return;
      var collapsible = el.closest('.collapsible-section');
      if (collapsible && collapsible.classList.contains('collapsed')) {
        collapsible.classList.remove('collapsed');
      }
      if (!el.classList.contains('expanded')) el.classList.add('expanded');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('highlight');
      setTimeout(function() { el.classList.remove('highlight'); }, 2000);
      updateHash();
    }

    /* ---- URL hash routing ---- */
    function updateHash() {
      var activeTab = document.querySelector('.tab.active');
      if (!activeTab) return;
      var tab = activeTab.dataset.tab;
      var hash = '#' + tab;
      if (tab === 'schedule') {
        var expanded = document.querySelector('#panel-schedule .day-group.expanded');
        if (expanded) hash += '/' + expanded.id;
      }
      history.replaceState(null, '', hash);
    }

    function restoreFromHash() {
      var hash = window.location.hash.substring(1);
      if (!hash) {
        var todayEl = document.getElementById('day-' + new Date().toISOString().substring(0, 10));
        if (todayEl) todayEl.classList.add('expanded');
        return;
      }
      var parts = hash.split('/');
      var tab = parts[0];
      if (tab === 'ci' || tab === 'schedule') {
        document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
        document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
        var tabEl = document.querySelector('.tab[data-tab="' + tab + '"]');
        if (tabEl) tabEl.classList.add('active');
        var panelEl = document.getElementById('panel-' + tab);
        if (panelEl) panelEl.classList.add('active');
      }
      if (parts[1]) {
        var dayEl = document.getElementById(parts[1]);
        if (dayEl) {
          dayEl.classList.add('expanded');
          setTimeout(function() { dayEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100);
        }
      } else if (!hash || tab === 'schedule') {
        var todayEl = document.getElementById('day-' + new Date().toISOString().substring(0, 10));
        if (todayEl) todayEl.classList.add('expanded');
      }
    }

    /* ---- Keyboard navigation ---- */
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        var el = document.activeElement;
        if (el && el.classList.contains('day-group-header')) {
          e.preventDefault();
          toggleDay(el);
        } else if (el && el.classList.contains('run-header')) {
          e.preventDefault();
          toggleRun(el);
        } else if (el && el.classList.contains('tab')) {
          e.preventDefault();
          el.click();
        } else if (el && el.classList.contains('collapsible-header')) {
          e.preventDefault();
          toggleCollapsible(el);
        }
      }
    });

    /* ---- Theme toggle ---- */
    function getSystemTheme() {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function applyTheme(theme) {
      if (theme === 'system') {
        document.documentElement.removeAttribute('data-theme');
      } else {
        document.documentElement.setAttribute('data-theme', theme);
      }
      var effective = theme === 'system' ? getSystemTheme() : theme;
      document.getElementById('theme-checkbox').checked = effective === 'dark';
    }

    function toggleTheme(isDark) {
      var next = isDark ? 'dark' : 'light';
      localStorage.setItem('theme', next);
      applyTheme(next);
    }

    applyTheme(localStorage.getItem('theme') || 'system');

    /* ---- Format generated-at timestamp ---- */
    var genAtEl = document.getElementById('generated-at');
    if (genAtEl) {
      var iso = genAtEl.textContent;
      genAtEl.textContent = formatDate(iso) + ', ' + formatTime(iso) + ' UTC';
    }

    /* ---- Render ---- */
    document.getElementById('schedule-count').textContent = CRON_DATA.length;
    document.getElementById('ci-count').textContent = CI_DATA.length;

    var drilldown = renderRecentFailures(CRON_DATA) + renderDayGroups(CRON_DATA);
    var divider = drilldown ? '<hr class="drilldown-divider">' : '';
    document.getElementById('panel-schedule').innerHTML =
      renderStatusBanner(CRON_DATA) + renderDeviceGrid(CRON_DATA) + renderUptimeBars(CRON_DATA) + divider + drilldown;

    document.getElementById('panel-ci').innerHTML =
      renderCiSummary(CI_DATA) + renderCiGroups(CI_DATA);

    restoreFromHash();
  </script>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Scope: CI (push / PR)                                              */
/*  - Upload to ci/{timestamp}_{branch}_{sha}/                        */
/*  - Update ci/manifest.json and regenerate dashboard                 */
/* ------------------------------------------------------------------ */

async function runCi(s3: S3Client, meta: RunMeta): Promise<void> {
  const prefix = `ci/${meta.timestamp}_${meta.branch}_${meta.shortSha}/`;
  const reportUrl = `${buildBaseUrl()}/${prefix}index.html`;

  console.log(`[ci] Uploading report to s3://${BUCKET}/${prefix}...`);
  const fileCount = await uploadReportFiles(s3, prefix);
  console.log(`[ci] Uploaded ${fileCount} files.`);

  // Update CI manifest
  // NOTE: This read-modify-write is not atomic — parallel CI runs could race.
  // Impact is low (lost manifest entries; reports themselves are not affected).
  // A proper fix would use S3 conditional PUT (ETag/If-Match).
  console.log('[ci] Updating CI manifest...');
  const ciManifest = await downloadManifest(s3, 'ci/manifest.json');

  ciManifest.unshift({
    prefix,
    timestamp: new Date().toISOString(),
    branch: meta.branch,
    sha: meta.sha,
    status: meta.status,
    url: reportUrl,
    devices: meta.devices,
    durationMs: meta.durationMs,
  });

  // Keep only last 31 days for CI too
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const prunedCi = ciManifest.filter((e) => new Date(e.timestamp).getTime() > cutoff);

  await uploadFile(s3, 'ci/manifest.json', JSON.stringify(prunedCi, null, 2), 'application/json');
  console.log(`[ci] CI manifest updated (${prunedCi.length} entries).`);

  // Regenerate dashboard with both datasets
  console.log('[ci] Regenerating dashboard...');
  const cronManifest = await downloadManifest(s3, 'reports/manifest.json');
  const indexHtml = generateDashboardHtml(cronManifest, prunedCi);
  await uploadFile(s3, 'reports/index.html', indexHtml, 'text/html', 'no-cache');

  console.log('');
  console.log(`Report URL: ${reportUrl}`);
  writeGithubOutput('report-url', reportUrl);
}

/* ------------------------------------------------------------------ */
/*  Scope: Cron (scheduled monitoring)                                 */
/*  - Upload to reports/{timestamp}_{branch}_{sha}/                   */
/*  - Update manifest.json and regenerate dashboard                    */
/*  - Prune entries older than 31 days                                 */
/* ------------------------------------------------------------------ */

async function runCron(s3: S3Client, meta: RunMeta): Promise<void> {
  const prefix = `reports/${meta.timestamp}_${meta.branch}_${meta.shortSha}/`;
  const reportUrl = `${buildBaseUrl()}/${prefix}index.html`;

  // 1. Upload report files
  console.log(`[cron] Uploading report to s3://${BUCKET}/${prefix}...`);
  const fileCount = await uploadReportFiles(s3, prefix);
  console.log(`[cron] Uploaded ${fileCount} files.`);

  // 2. Update cron manifest
  console.log('[cron] Updating manifest...');
  const manifest = await downloadManifest(s3, 'reports/manifest.json');

  manifest.unshift({
    prefix,
    timestamp: new Date().toISOString(),
    branch: meta.branch,
    sha: meta.sha,
    status: meta.status,
    url: reportUrl,
    devices: meta.devices,
    durationMs: meta.durationMs,
  });

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const pruned = manifest.filter((e) => new Date(e.timestamp).getTime() > cutoff);

  await uploadFile(s3, 'reports/manifest.json', JSON.stringify(pruned, null, 2), 'application/json');
  console.log(`[cron] Manifest updated (${pruned.length} entries, pruned ${manifest.length - pruned.length}).`);

  // 3. Generate and upload dashboard with both datasets
  console.log('[cron] Generating dashboard...');
  const ciManifest = await downloadManifest(s3, 'ci/manifest.json');
  const indexHtml = generateDashboardHtml(pruned, ciManifest);
  await uploadFile(s3, 'reports/index.html', indexHtml, 'text/html', 'no-cache');

  console.log('');
  console.log(`Report URL: ${reportUrl}`);
  console.log(`Dashboard:  ${buildBaseUrl()}/reports/index.html`);
  writeGithubOutput('report-url', reportUrl);
}

/* ------------------------------------------------------------------ */
/*  Shared                                                             */
/* ------------------------------------------------------------------ */

interface RunMeta {
  status: string;
  scope: Scope;
  branch: string;
  sha: string;
  shortSha: string;
  timestamp: string;
  devices?: Record<string, DeviceResult>;
  durationMs?: number;
}

function writeGithubOutput(key: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  if (!BUCKET) {
    console.error('Error: S3_BUCKET_NAME is required');
    process.exit(1);
  }

  const { status, scope } = parseArgs();
  const branch = process.env.GITHUB_REF_NAME || gitValue('git branch --show-current');
  const sha = process.env.GITHUB_SHA || gitValue('git rev-parse HEAD');

  const devices = parseTestResults();
  if (devices) {
    console.log(`Parsed device results: ${Object.keys(devices).map((d) => DEVICE_LABELS[d] || d).join(', ')}`);
  }

  // Wall-clock duration = max across devices (they run in parallel)
  const durationMs = devices
    ? Math.max(...Object.values(devices).map((d) => d.durationMs || 0))
    : undefined;

  const meta: RunMeta = {
    status,
    scope,
    branch,
    sha,
    shortSha: sha.substring(0, 7),
    timestamp: new Date().toISOString().replace(/[:.]/g, '-').replace('Z', 'Z'),
    devices,
    durationMs: durationMs || undefined,
  };

  // Verify report directory exists
  try {
    statSync(REPORT_DIR);
  } catch {
    console.error('Error: playwright-report/ directory not found. Run tests first.');
    process.exit(1);
  }

  console.log(`Scope: ${scope} | Branch: ${branch} | Status: ${status}`);

  const s3 = createS3Client();

  if (scope === 'cron') {
    await runCron(s3, meta);
  } else {
    await runCi(s3, meta);
  }
}

main().catch((err) => {
  console.error('Upload failed:', err);
  process.exit(1);
});
