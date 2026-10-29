import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const policy = JSON.parse(readFileSync(new URL('../.github/release-policy.json', import.meta.url), 'utf8'));
const repository = policy.repository;
const commitPattern = /^[a-f0-9]{40}$/;

export function latestPushCI(runs, sha, branch) {
  return runs.filter(run => run.head_sha === sha && run.head_branch === branch && run.event === 'push')
    .sort((a, b) => b.run_number - a.run_number)[0];
}

export function validateCandidate(c) {
  assert.ok(['production', 'staging'].includes(c.stage), 'Invalid deployment stage');
  assert.match(c.sha, commitPattern, 'An immutable full SHA is required');
  assert.equal(c.sha, c.currentSha, 'Candidate is stale; branch advanced');
  const branch = c.stage === 'production' ? 'main' : 'dev';
  assert.equal(c.ci?.status, 'completed', 'CI must finish before deployment');
  assert.equal(c.ci?.conclusion, 'success', 'Successful CI is required');
  assert.equal(c.ci.event, 'push', 'CI must validate a branch push, not a PR merge ref');
  assert.equal(c.ci.head_sha, c.sha, 'CI must validate the deployed SHA');
  assert.equal(c.ci.head_branch, branch, 'CI must validate the deployment branch');
  if (c.stage === 'production') {
    assert.equal(c.ref, 'refs/heads/main', 'Production must dispatch from main');
    assert.equal(c.event, 'workflow_dispatch', 'Production requires deliberate dispatch');
    assert.equal(c.actor, policy.owner, 'Only the release owner can authorize production');
    assert.match(c.version, /^v\d+\.\d+\.\d+$/, 'Use an immutable vX.Y.Z release version');
    const evidenceUrl = new URL(c.recoveryUrl);
    assert.equal(evidenceUrl.origin, 'https://github.com');
    assert.ok(evidenceUrl.pathname.startsWith(`/${repository}/issues/`) || evidenceUrl.pathname.startsWith(`/${repository}/pull/`), 'Record recovery evidence in this repository');
    assert.equal(c.stagingRun?.conclusion, 'success', 'Staging deployment must succeed');
    assert.equal(c.stagingRun.path, '.github/workflows/deploy.yml', 'Evidence must come from the deployment workflow');
    assert.equal(c.stagingRun.head_repository?.full_name, repository, 'Evidence must come from this repository');
    assert.equal(c.staging?.stage, 'staging', 'A staging record is required');
    assert.equal(c.staging.verified, true, 'Staging probes must have passed');
    assert.equal(c.staging.runId, String(c.stagingRun.id), 'Evidence/run mismatch');
    assert.match(c.staging.sha, commitPattern, 'Staging must identify its deployed SHA');
    assert.equal(c.staging.tree, c.stagingCommitTree, 'Invalid staging tree provenance');
    assert.equal(c.staging.tree, c.tree, 'Release tree was not verified on staging');
  } else {
    assert.ok(['workflow_run', 'workflow_dispatch'].includes(c.event), 'Unsupported staging trigger');
    if (c.event === 'workflow_dispatch') assert.equal(c.ref, 'refs/heads/dev', 'Staging dispatch must use dev');
  }
}

async function api(path) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`GitHub evidence lookup failed: ${response.status}`);
  return response.json();
}

async function main() {
  assert.equal(process.env.GITHUB_REPOSITORY, repository, 'Unexpected repository');
  const stage = process.env.STAGE;
  const branch = stage === 'production' ? 'main' : 'dev';
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (process.env.GITHUB_EVENT_NAME === 'workflow_run') {
    assert.equal(stage, 'staging');
    assert.equal(event.workflow_run.event, 'push');
    assert.equal(event.workflow_run.head_branch, 'dev');
    assert.equal(event.workflow_run.head_repository.full_name, repository);
    assert.equal(event.workflow_run.conclusion, 'success');
  }
  const sha = process.env.RELEASE_SHA || event.workflow_run?.head_sha || process.env.GITHUB_SHA;
  assert.match(sha, commitPattern);
  const head = await api(`branches/${branch}`);
  const commit = await api(`git/commits/${sha}`);
  const runs = await api(`actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=100`);
  const ci = latestPushCI(runs.workflow_runs, sha, branch);
  const c = { stage, sha, tree: commit.tree.sha, currentSha: head.commit.sha, ci,
    actor: process.env.GITHUB_ACTOR, ref: process.env.GITHUB_REF, event: process.env.GITHUB_EVENT_NAME,
    version: process.env.RELEASE_VERSION || '', recoveryUrl: process.env.RECOVERY_URL || '' };
  if (stage === 'production') {
    assert.match(process.env.STAGING_RUN_ID || '', /^\d+$/);
    c.stagingRun = await api(`actions/runs/${process.env.STAGING_RUN_ID}`);
    const dir = mkdtempSync(join(tmpdir(), 'release-evidence-'));
    try {
      execFileSync('gh', ['run', 'download', process.env.STAGING_RUN_ID, '--repo', repository, '--name', 'release-evidence', '--dir', dir], { stdio: 'pipe' });
      c.staging = JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
    assert.match(c.staging.sha, commitPattern);
    c.stagingCommitTree = (await api(`git/commits/${c.staging.sha}`)).tree.sha;
    // Existing tags are never moved, even after a partially failed release.
    const tag = await fetch(`https://api.github.com/repos/${repository}/git/ref/tags/${encodeURIComponent(c.version)}`, {
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
    });
    assert.equal(tag.status, 404, 'Release tag already exists or cannot be checked');
  }
  validateCandidate(c);
  if (stage === 'production') {
    const match = new URL(c.recoveryUrl).pathname.match(/\/(?:issues|pull)\/(\d+)$/);
    assert.ok(match, 'Recovery evidence must identify a repository issue or PR');
    const evidence = await api(`issues/${match[1]}`);
    assert.equal(evidence.user.login, policy.owner, 'Recovery evidence must be written by the release owner');
    assert.ok(evidence.body?.includes(`Version: ${c.version}`), 'Recovery evidence must authorize this release version');
    assert.ok(evidence.body?.includes(`Release tree: ${c.tree}`), 'Recovery evidence must cover this exact release tree');
    assert.match(evidence.body, /^Walkthrough: passed$/m, 'Record a completed walkthrough');
    assert.match(evidence.body, /^Recovery: verified$/m, 'Record a verified backup and rollback rehearsal');
    assert.match(evidence.body, /^Previous release: .+$/m, 'Identify the recovery baseline');
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `sha=${sha}\ntree=${c.tree}\n`);
  console.log(`Validated ${stage} candidate ${sha}, tree ${c.tree}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
