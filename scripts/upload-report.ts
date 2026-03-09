import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
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
const MANIFEST_KEY = 'reports/manifest.json';
const INDEX_KEY = 'reports/index.html';
const RETENTION_DAYS = 31;
const UPLOAD_BATCH_SIZE = 20;

/* ------------------------------------------------------------------ */
/*  CLI args                                                           */
/* ------------------------------------------------------------------ */

function parseArgs(): { status: string } {
  const statusArg = process.argv.find((a) => a.startsWith('--status='));
  const status = statusArg?.split('=')[1] || 'unknown';
  return { status };
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

/* ------------------------------------------------------------------ */
/*  Manifest types                                                     */
/* ------------------------------------------------------------------ */

interface ManifestEntry {
  prefix: string;
  timestamp: string;
  branch: string;
  sha: string;
  status: string;
  trigger: string;
  url: string;
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

async function downloadManifest(s3: S3Client): Promise<ManifestEntry[]> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: MANIFEST_KEY }),
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
/*  Index HTML generation                                              */
/* ------------------------------------------------------------------ */

function generateIndexHtml(entries: ManifestEntry[]): string {
  const rows = entries
    .map((e) => {
      const date = new Date(e.timestamp).toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      });
      const dot = e.status === 'passed' ? '&#x1F7E2;' : '&#x1F534;';
      const sha = e.sha.substring(0, 7);
      return `        <tr>
          <td>${date}</td>
          <td>${e.branch}</td>
          <td><code>${sha}</code></td>
          <td>${dot} ${e.status}</td>
          <td>${e.trigger}</td>
          <td><a href="${e.url}">View Report</a></td>
        </tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="300">
  <title>Lara E2E Test Reports</title>
  <style>
    :root { --bg: #fff; --fg: #1a1a2e; --border: #e0e0e0; --hover: #f5f5f5; --link: #0969da; }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #0d1117; --fg: #c9d1d9; --border: #30363d; --hover: #161b22; --link: #58a6ff; }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--fg); padding: 2rem; }
    h1 { margin-bottom: 0.5rem; font-size: 1.5rem; }
    p.subtitle { color: #6e7681; margin-bottom: 1.5rem; font-size: 0.875rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border); }
    th { font-weight: 600; }
    tr:hover { background: var(--hover); }
    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { background: var(--hover); padding: 0.15rem 0.4rem; border-radius: 3px; font-size: 0.85em; }
    .empty { text-align: center; padding: 3rem; color: #6e7681; }
  </style>
</head>
<body>
  <h1>Lara E2E Test Reports</h1>
  <p class="subtitle">Auto-refreshes every 5 minutes. Reports are retained for ${RETENTION_DAYS} days.</p>
  ${
    entries.length === 0
      ? '<p class="empty">No reports yet.</p>'
      : `<table>
      <thead>
        <tr>
          <th>Date (UTC)</th>
          <th>Branch</th>
          <th>Commit</th>
          <th>Status</th>
          <th>Trigger</th>
          <th>Report</th>
        </tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>`
  }
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  if (!BUCKET) {
    console.error('Error: S3_BUCKET_NAME is required');
    process.exit(1);
  }

  const { status } = parseArgs();
  const branch = process.env.GITHUB_REF_NAME || gitValue('git branch --show-current');
  const sha = process.env.GITHUB_SHA || gitValue('git rev-parse HEAD');
  const shortSha = sha.substring(0, 7);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
  const trigger = process.env.GITHUB_ACTIONS ? 'ci' : 'manual';
  const prefix = `reports/${timestamp}_${branch}_${shortSha}/`;

  const domain = CLOUDFRONT_DOMAIN || `${BUCKET}.s3.${REGION}.amazonaws.com`;
  const protocol = CLOUDFRONT_DOMAIN ? 'https' : 'https';
  const reportUrl = `${protocol}://${domain}/${prefix}index.html`;

  const s3 = createS3Client();

  // Verify report directory exists
  try {
    statSync(REPORT_DIR);
  } catch {
    console.error(`Error: playwright-report/ directory not found. Run tests first.`);
    process.exit(1);
  }

  // 1. Upload report files
  console.log(`Uploading report to s3://${BUCKET}/${prefix}...`);
  const fileCount = await uploadReportFiles(s3, prefix);
  console.log(`Uploaded ${fileCount} files.`);

  // 2. Update manifest
  console.log('Updating manifest...');
  const manifest = await downloadManifest(s3);

  const entry: ManifestEntry = {
    prefix,
    timestamp: new Date().toISOString(),
    branch,
    sha,
    status,
    trigger,
    url: reportUrl,
  };

  manifest.unshift(entry);

  // Prune entries older than retention period
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const pruned = manifest.filter((e) => new Date(e.timestamp).getTime() > cutoff);

  await uploadFile(s3, MANIFEST_KEY, JSON.stringify(pruned, null, 2), 'application/json');
  console.log(`Manifest updated (${pruned.length} entries, pruned ${manifest.length - pruned.length}).`);

  // 3. Generate and upload index page
  console.log('Generating index page...');
  const indexHtml = generateIndexHtml(pruned);
  await uploadFile(s3, INDEX_KEY, indexHtml, 'text/html', 'no-cache');

  // 4. Output report URL
  console.log('');
  console.log(`Report URL: ${reportUrl}`);
  console.log(`Dashboard:  ${protocol}://${domain}/reports/index.html`);

  // Write URL to GitHub output if running in CI
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_OUTPUT, `report-url=${reportUrl}\n`);
  }
}

main().catch((err) => {
  console.error('Upload failed:', err);
  process.exit(1);
});
