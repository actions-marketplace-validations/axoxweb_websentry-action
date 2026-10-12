import * as core from '@actions/core';
import * as github from '@actions/github';
import WebSentry, { WebSentryError } from 'websentry-api';
import { renderReport, COMMENT_MARKER, type Outcome, type ScanDetail, type Finding } from './render.js';

type FailOn = 'none' | 'regression' | 'score' | 'both';

function readFailOn(minimumScore: number | null): FailOn {
  const raw = core.getInput('fail-on').trim().toLowerCase();
  if (raw === 'none' || raw === 'regression' || raw === 'score' || raw === 'both') {
    return raw;
  }
  if (raw !== '') {
    core.warning(`Unknown fail-on value "${raw}". Falling back to the default.`);
  }
  // Default: honour a score floor when one was given, otherwise gate on regressions.
  return minimumScore === null ? 'regression' : 'both';
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('The url input is empty.');
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`"${raw}" is not a valid URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs can be scanned.');
  }
  return parsed.toString();
}

/** The pull request this run belongs to, if any. */
async function resolvePullRequest(token: string): Promise<number | null> {
  const fromPayload = github.context.payload.pull_request?.number;
  if (typeof fromPayload === 'number') return fromPayload;

  // deployment_status and push runs carry no pull request, so ask by commit.
  const sha: string | undefined = github.context.payload.deployment?.sha || github.context.sha;
  if (!sha) return null;

  try {
    const octokit = github.getOctokit(token);
    const { data } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
      ...github.context.repo,
      commit_sha: sha,
    });
    const open = data.find(pr => pr.state === 'open');
    return open ? open.number : null;
  } catch (e) {
    core.debug(`Could not look up a pull request for the commit: ${(e as Error).message}`);
    return null;
  }
}

/**
 * One comment per pull request, edited in place. A 40 commit pull request
 * should carry one current comment, not 40 stale ones.
 */
async function upsertComment(token: string, prNumber: number, body: string): Promise<void> {
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;

  const existing = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });
  const mine = existing.find(c => typeof c.body === 'string' && c.body.includes(COMMENT_MARKER));

  if (mine) {
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: mine.id, body });
  } else {
    await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
  }
}

async function run(): Promise<void> {
  const apiKey = core.getInput('api-key', { required: true }).trim();
  core.setSecret(apiKey);

  const url = normalizeUrl(core.getInput('url', { required: true }));
  const baseUrl = core.getInput('api-url').trim() || 'https://websentry.dev';
  const minimumRaw = core.getInput('minimum-score').trim();
  const minimumScore = minimumRaw === '' ? null : Number(minimumRaw);
  if (minimumScore !== null && (Number.isNaN(minimumScore) || minimumScore < 0 || minimumScore > 100)) {
    throw new Error(`minimum-score must be a number between 0 and 100, received "${minimumRaw}".`);
  }
  const failOn = readFailOn(minimumScore);
  const wantComment = core.getInput('comment').trim().toLowerCase() !== 'false';
  const token = core.getInput('github-token').trim();

  const client = new WebSentry(apiKey, { baseUrl });

  core.info(`Scanning ${url}`);
  const summary = await client.scan(url);
  core.info(`Grade ${summary.grade}, score ${summary.score}`);

  const reportUrl = `${baseUrl.replace(/\/$/, '')}/report/${summary.scanId}`;
  const notes: string[] = [];
  let detail: ScanDetail | null = null;

  try {
    const report = await client.getScan(summary.scanId);
    const categories = Object.values(report.scan.results.categories ?? {}).map(c => ({
      name: c.name,
      grade: c.grade,
      score: c.score,
      maxScore: c.maxScore,
    }));
    const regressed: Finding[] = report.diff?.regressed ?? [];
    const fixed: Finding[] = report.diff?.fixed ?? [];
    detail = {
      categories,
      regressed,
      fixed,
      previous: report.diff
        ? { grade: report.diff.prevGrade, score: report.diff.prevScore, date: report.diff.prevDate }
        : null,
    };
  } catch (e) {
    const status = e instanceof WebSentryError ? e.status : 0;
    if (status === 403 || status === 402) {
      notes.push(
        'Detailed results are part of the Pro and Agency plans, so this run checked the score only.'
      );
      core.info('Detailed results are not available on this plan. Continuing with the score.');
    } else {
      notes.push('The detailed report could not be loaded, so this run checked the score only.');
      core.warning(`Could not load the detailed report: ${(e as Error).message}`);
    }
  }

  // ── Gate ──
  const reasons: string[] = [];
  const regressedCount = detail ? detail.regressed.length : null;

  const scoreGateOn = failOn === 'score' || failOn === 'both';
  const regressionGateOn = failOn === 'regression' || failOn === 'both';

  if (scoreGateOn && minimumScore !== null && summary.score < minimumScore) {
    reasons.push(`Score ${summary.score} is below the minimum of ${minimumScore}.`);
  }
  if (scoreGateOn && minimumScore === null) {
    core.warning('fail-on includes "score" but no minimum-score was set, so no score floor is enforced.');
  }
  if (!scoreGateOn && minimumScore !== null) {
    core.warning(`minimum-score is set but fail-on is "${failOn}", so the score floor is not enforced.`);
  }

  if (regressionGateOn) {
    if (regressedCount === null) {
      core.warning('Regression gating needs detailed results, which this plan does not include. Skipping that check.');
    } else if (regressedCount > 0) {
      reasons.push(
        `${regressedCount} ${regressedCount === 1 ? 'check' : 'checks'} regressed since the previous scan of this URL.`
      );
    }
  }

  const outcome: Outcome = {
    url,
    grade: summary.grade,
    score: summary.score,
    scanId: summary.scanId,
    reportUrl,
    detail,
    regressedCount,
    failed: reasons.length > 0,
    reasons,
    notes,
  };

  // ── Report ──
  const body = renderReport(outcome);
  await core.summary.addRaw(body.replace(COMMENT_MARKER, '')).write();

  core.setOutput('score', String(summary.score));
  core.setOutput('grade', summary.grade);
  core.setOutput('scan-id', summary.scanId);
  core.setOutput('report-url', reportUrl);
  core.setOutput('new-findings', String(regressedCount ?? 0));
  core.setOutput('fixed-findings', String(detail ? detail.fixed.length : 0));

  if (wantComment && token) {
    const prNumber = await resolvePullRequest(token);
    if (prNumber === null) {
      core.info('No pull request is associated with this run, so no comment was posted.');
    } else {
      try {
        await upsertComment(token, prNumber, body);
        core.info(`Updated the WebSentry comment on pull request #${prNumber}.`);
      } catch (e) {
        // Forked pull requests get a read only token, and a security tool that
        // red flags every community contribution gets removed. Never fail here.
        core.warning(
          `Could not post the pull request comment: ${(e as Error).message}. ` +
            'Pull requests from forks have read only tokens, and the workflow needs permissions: pull-requests: write.'
        );
      }
    }
  }

  if (outcome.failed) {
    core.setFailed(reasons.join(' '));
  }
}

run().catch((e: unknown) => {
  if (e instanceof WebSentryError) {
    if (e.status === 401) {
      core.setFailed('WebSentry rejected the key. Check the api-key secret.');
      return;
    }
    if (e.status === 429) {
      const reset = e.rateLimit?.reset ? ` Resets at ${new Date(e.rateLimit.reset * 1000).toISOString()}.` : '';
      core.setFailed(`WebSentry scan limit reached.${reset} Upgrade the plan or wait for the quota to reset.`);
      return;
    }
    core.setFailed(`WebSentry error ${e.status}: ${e.message}`);
    return;
  }
  core.setFailed((e as Error).message ?? 'The scan failed for an unknown reason.');
});
