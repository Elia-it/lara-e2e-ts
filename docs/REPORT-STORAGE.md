# Report Storage

Playwright HTML reports are uploaded to S3 and served via CloudFront. Two separate scopes keep CI artifacts isolated from production monitoring data.

## Scopes

### `ci/` — GitHub Actions (push / PR)

- S3 prefix: `ci/{timestamp}_{branch}_{sha}/`
- Upload-only: no manifest, no index page
- Purpose: attach a report URL to PR comments for quick review
- No retention tracking — relies on S3 lifecycle policy for cleanup

### `reports/` — Scheduled cron (production monitoring)

- S3 prefix: `reports/{timestamp}_{branch}_{sha}/`
- Maintains `reports/manifest.json` with run metadata
- Regenerates `reports/index.html` — a static dashboard listing all runs
- 31-day retention: old entries pruned from manifest on each upload, S3 lifecycle handles object deletion

## S3 Key Structure

```
ci/
  2026-03-09T10-30-00Z_feature-foo_abc1234/   # Ephemeral CI report
    index.html
    data/
reports/
  2026-03-09T10-30-00Z_main_abc1234/          # Cron monitoring report
    index.html
    data/
    trace/
  manifest.json                                # Run metadata (cron only)
  index.html                                   # Static dashboard (cron only)
```

## Upload Script

`scripts/upload-report.ts` — single script, no Playwright dependency.

### CLI

```bash
npx tsx scripts/upload-report.ts --status=passed --scope=ci
npx tsx scripts/upload-report.ts --status=failed --scope=cron
```

- `--scope` auto-detects from `GITHUB_EVENT_NAME` if not provided (`schedule` → `cron`, everything else → `ci`)
- `--status` comes from the Playwright exit code in CI

### Environment Variables

| Variable | Description |
|---|---|
| `S3_BUCKET_NAME` | S3 bucket name |
| `AWS_REGION` | AWS region (default: `eu-west-1`) |
| `AWS_ACCESS_KEY_ID` | IAM access key |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key |
| `CLOUDFRONT_DOMAIN` | CloudFront distribution domain |

## Access Model

- S3 bucket is **fully private** (block all public access)
- CloudFront distribution with **Origin Access Control (OAC)** reads from S3
- Dashboard URL: `https://{domain}/reports/index.html`
- CI report URL: `https://{domain}/ci/{run}/index.html`
- Cron report URL: `https://{domain}/reports/{run}/index.html`

## Retention

- **S3 Lifecycle Policy:** Configure expiration on both `ci/` and `reports/` prefixes (e.g., 7 days for `ci/`, 31 days for `reports/`)
- **Manifest pruning:** Upload script removes cron entries older than 31 days from `manifest.json`

## AWS Setup

1. Create an S3 bucket and configure lifecycle policies (e.g., 7 days for `ci/`, 31 days for `reports/`).
2. Create a CloudFront distribution with OAC pointing to the bucket.
3. Create an IAM user with `s3:PutObject`, `s3:GetObject`, `s3:ListBucket`, `s3:DeleteObject` permissions on the bucket.
4. Add `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET_NAME`, and `CLOUDFRONT_DOMAIN` to `.env` (local) or GitHub Actions secrets (CI).

## Local Usage

```bash
# Run tests
npm test

# Upload as CI scope (default when not in scheduled run)
npm run report:upload -- --status=passed

# Upload as cron scope
npm run report:upload -- --status=passed --scope=cron
```

## CI Integration

The upload step runs after every test run (including failures). Scope is set automatically based on the trigger event. A PR comment is posted with the report URL on pull requests.

See `.github/workflows/e2e.yml` for the full workflow.
