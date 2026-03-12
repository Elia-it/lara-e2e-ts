import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN;
const RESULTS_FILE = join(process.cwd(), 'test-results.json');

/* ------------------------------------------------------------------ */
/*  CLI args                                                           */
/* ------------------------------------------------------------------ */

function parseArgs(): { reportUrl: string } {
  const reportUrlArg = process.argv.find((a) => a.startsWith('--report-url='));
  const reportUrl = reportUrlArg?.split('=').slice(1).join('=') || '';

  return { reportUrl };
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

/* ------------------------------------------------------------------ */
/*  Playwright JSON result parsing                                     */
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

interface PlaywrightTest {
  projectName: string;
  status: string; // 'expected' | 'unexpected' | 'flaky' | 'skipped'
}

interface ProjectSummary {
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
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

function parseResults(): Map<string, ProjectSummary> {
  const raw = readFileSync(RESULTS_FILE, 'utf-8');
  const report = JSON.parse(raw) as PlaywrightResult;

  const projects = new Map<string, ProjectSummary>();

  for (const suite of report.suites) {
    for (const test of collectTests(suite)) {
      const name = test.projectName || 'unknown';

      if (!projects.has(name)) {
        projects.set(name, { passed: 0, failed: 0, flaky: 0, skipped: 0 });
      }

      const summary = projects.get(name)!;

      switch (test.status) {
        case 'expected':
          summary.passed++;
          break;
        case 'unexpected':
          summary.failed++;
          break;
        case 'flaky':
          summary.flaky++;
          break;
        case 'skipped':
          summary.skipped++;
          break;
      }
    }
  }

  return projects;
}

/* ------------------------------------------------------------------ */
/*  Device display names                                               */
/* ------------------------------------------------------------------ */

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
/*  Slack message                                                      */
/* ------------------------------------------------------------------ */

function buildMessage(
  reportUrl: string,
  projects: Map<string, ProjectSummary>,
): object {
  const branch = process.env.GITHUB_REF_NAME || gitValue('git branch --show-current');
  const sha = (process.env.GITHUB_SHA || gitValue('git rev-parse HEAD')).substring(0, 7);
  const runId = process.env.GITHUB_RUN_ID || '';
  const repo = process.env.GITHUB_REPOSITORY || 'lara-e2e-ts';
  const eventName = process.env.GITHUB_EVENT_NAME || 'manual';
  const dashboardUrl = CLOUDFRONT_DOMAIN ? `https://${CLOUDFRONT_DOMAIN}/reports/index.html` : '';
  const actionsUrl = runId ? `https://github.com/${repo}/actions/runs/${runId}` : '';

  // Build per-device lines
  let allPassed = true;
  const deviceLines: string[] = [];

  for (const [projectName, summary] of projects) {
    const label = DEVICE_LABELS[projectName] || projectName;
    const hasFailed = summary.failed > 0;
    if (hasFailed) allPassed = false;

    const icon = hasFailed ? ':x:' : ':white_check_mark:';
    const parts = [`${summary.passed} passed`];
    if (summary.failed > 0) parts.push(`${summary.failed} failed`);
    if (summary.flaky > 0) parts.push(`${summary.flaky} flaky`);
    if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);

    deviceLines.push(`${icon}  *${label}*  —  ${parts.join(', ')}`);
  }

  const statusIcon = allPassed ? ':large_green_circle:' : ':red_circle:';
  const statusText = allPassed ? 'All Tests Passed' : 'Tests Failed';
  const triggerLabel = eventName === 'schedule' ? 'Cron' : 'CI';

  const links = [
    reportUrl ? `<${reportUrl}|View Report>` : null,
    actionsUrl ? `<${actionsUrl}|GitHub Actions>` : null,
    dashboardUrl ? `<${dashboardUrl}|Dashboard>` : null,
  ]
    .filter(Boolean)
    .join('  |  ');

  return {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${statusIcon} E2E ${triggerLabel}: ${statusText}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Branch:*\n\`${branch}\`` },
          { type: 'mrkdwn', text: `*Commit:*\n\`${sha}\`` },
        ],
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: deviceLines.join('\n'),
        },
      },
      ...(links
        ? [
            {
              type: 'divider',
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text: links },
            },
          ]
        : []),
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${triggerLabel} run  \u2022  ${new Date().toISOString()}`,
          },
        ],
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  if (!WEBHOOK_URL) {
    console.error('Error: SLACK_WEBHOOK_URL is required');
    process.exit(1);
  }

  const { reportUrl } = parseArgs();

  let projects: Map<string, ProjectSummary>;
  try {
    projects = parseResults();
  } catch (err) {
    console.error('Error: Could not parse test-results.json:', err);
    process.exit(1);
  }

  if (projects.size === 0) {
    console.error('Error: No test results found in test-results.json');
    process.exit(1);
  }

  const payload = buildMessage(reportUrl, projects);

  console.log('Sending Slack notification...');

  const response = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Slack API error (${response.status}): ${body}`);
    process.exit(1);
  }

  console.log('Slack notification sent.');
}

main().catch((err) => {
  console.error('Slack notification failed:', err);
  process.exit(1);
});
