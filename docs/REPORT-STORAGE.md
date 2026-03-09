# Report Storage

Playwright HTML reports are uploaded to S3 and served via CloudFront. A static index page lists all runs.

## Architecture

```
Playwright CI  ──npx tsx──▶  scripts/upload-report.ts  ──▶  S3 (reports/)
                                                         ──▶  CloudFront (public access)
                                                         ──▶  S3 Lifecycle (31-day expiration)
```

## S3 Key Structure

```
reports/
  2026-03-09T10-30-00Z_main_abc1234/    # One folder per test run
    index.html                           # Playwright HTML report entry point
    data/                                # Report data chunks
    trace/                               # Trace files (on failure)
  manifest.json                          # Run metadata for index generation
  index.html                             # Static dashboard listing all runs
```

## Upload Script

`scripts/upload-report.ts` — single script, no Playwright dependency. Runnable via `npx tsx scripts/upload-report.ts`.

### Inputs

| Source | Variable | Description |
|---|---|---|
| Environment | `S3_BUCKET_NAME` | S3 bucket name |
| Environment | `AWS_REGION` | AWS region (default: `eu-west-1`) |
| Environment | `AWS_ACCESS_KEY_ID` | IAM access key |
| Environment | `AWS_SECRET_ACCESS_KEY` | IAM secret key |
| Environment | `CLOUDFRONT_DOMAIN` | CloudFront distribution domain |
| CLI | `--status=passed\|failed` | Test run outcome |
| Auto-detected | Branch, commit SHA | From git or `GITHUB_REF_NAME`/`GITHUB_SHA` |

### Steps

1. Build S3 prefix: `reports/{timestamp}_{branch}_{shortSha}/`
2. Walk `playwright-report/` recursively, upload all files with correct `Content-Type` (parallel, batches of 20)
3. Download `reports/manifest.json` from S3 (or empty array if first run)
4. Append entry with run metadata
5. Prune entries older than 31 days
6. Upload updated `manifest.json`
7. Generate static `index.html` from manifest (inline HTML, no framework)
8. Upload `index.html` with `Cache-Control: no-cache`
9. Print report URL to stdout (and write to `GITHUB_OUTPUT` in CI)

## Access Model

- S3 bucket is **fully private** (block all public access)
- CloudFront distribution with **Origin Access Control (OAC)** reads from S3
- Dashboard URL: `https://{domain}/reports/index.html`
- Report URL: `https://{domain}/reports/{run}/index.html`

## Retention

- **S3 Lifecycle Policy:** Objects under `reports/` expire after 31 days (automatic)
- **Manifest pruning:** Upload script removes entries older than 31 days from `manifest.json`

## AWS Setup

1. Create an S3 bucket and configure a lifecycle policy to expire objects under `reports/` after 31 days.
2. Create a CloudFront distribution with OAC pointing to the bucket.
3. Create an IAM user with `s3:PutObject`, `s3:GetObject`, `s3:ListBucket`, `s3:DeleteObject` permissions on the bucket.
4. Add `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET_NAME`, and `CLOUDFRONT_DOMAIN` to `.env` (local) or GitHub Actions secrets (CI).

## Local Usage

```bash
# Run tests
npm test

# Upload report
npm run report:upload -- --status=passed

# Output:
# Report URL: https://d1234.cloudfront.net/reports/2026-03-09T.../index.html
# Dashboard:  https://d1234.cloudfront.net/reports/index.html
```

## CI Integration

The upload step runs after every test run (including failures). A PR comment is posted with the report URL.

See `.github/workflows/e2e.yml` for the full workflow.
