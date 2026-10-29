import { readFileSync } from 'node:fs';
const policy = JSON.parse(readFileSync(new URL('../.github/release-policy.json', import.meta.url), 'utf8'));
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { latestPushCI, validateCandidate } from './release-gate.mjs';

const sha = 'a'.repeat(40);
const tree = 'b'.repeat(40);
function candidate() {
  return {
    stage: 'production', sha, currentSha: sha, tree, actor: policy.owner,
    event: 'workflow_dispatch', ref: 'refs/heads/main', version: 'v0.1.0',
    ci: { status: 'completed', conclusion: 'success', event: 'push', head_sha: sha, head_branch: 'main' },
    staging: { stage: 'staging', sha, tree, verified: true, runId: '123' },
    stagingRun: { id: 123, conclusion: 'success', path: '.github/workflows/deploy.yml', head_repository: { full_name: policy.repository } },
    stagingCommitTree: tree, recoveryUrl: `https://github.com/${policy.repository}/issues/1`,
  };
}
test('accepts a main release only with successful exact-SHA CI and same-tree staging evidence', () => {
  assert.doesNotThrow(() => validateCandidate(candidate()));
});
test('accepts an alpha release version', () => {
  assert.doesNotThrow(() => validateCandidate({ ...candidate(), version: 'v0.1.0-alpha.1' }));
});
for (const [name, mutate] of [
  ['stale candidate', c => { c.currentSha = 'c'.repeat(40); }],
  ['CI for a different commit', c => { c.ci.head_sha = 'c'.repeat(40); }],
  ['failed CI', c => { c.ci.conclusion = 'failure'; }],
  ['PR CI instead of branch push CI', c => { c.ci.event = 'pull_request'; }],
  ['production invoked from dev', c => { c.ref = 'refs/heads/dev'; }],
  ['unapproved production actor', c => { c.actor = 'another-user'; }],
  ['automatic production invocation', c => { c.event = 'workflow_run'; }],
  ['different staging tree', c => { c.staging.tree = 'c'.repeat(40); }],
  ['failed staging deployment', c => { c.stagingRun.conclusion = 'failure'; }],
  ['unverified staging record', c => { c.staging.verified = false; }],
  ['forged staging tree', c => { c.stagingCommitTree = 'c'.repeat(40); }],
  ['foreign staging run', c => { c.stagingRun.head_repository.full_name = 'someone/else'; }],
  ['missing recovery evidence', c => { c.recoveryUrl = ''; }],
  ['invalid version', c => { c.version = 'latest'; }],
  ['unknown pre-release label', c => { c.version = 'v0.1.0-nightly.1'; }],
]) {
  test(`rejects ${name} before deployment`, () => {
    const c = candidate(); mutate(c);
    assert.throws(() => validateCandidate(c));
  });
}
test('staging requires dev push CI, without production-only release metadata', () => {
  const c = candidate();
  Object.assign(c, { stage: 'staging', event: 'workflow_run', ref: 'refs/heads/dev', version: '' });
  c.ci.head_branch = 'dev';
  assert.doesNotThrow(() => validateCandidate(c));
  c.ci.head_branch = 'main';
  assert.throws(() => validateCandidate(c));
});

test('a later failed CI run blocks a commit even when an older run succeeded', () => {
  const c = candidate();
  const runs = [{ ...c.ci, run_number: 1 }, { ...c.ci, run_number: 2, conclusion: 'failure' }];
  c.ci = latestPushCI(runs, sha, 'main');
  assert.throws(() => validateCandidate(c));
});
test('in-progress rerun cannot reuse a previous successful conclusion', () => {
  const c = candidate(); c.ci.status = 'in_progress';
  assert.throws(() => validateCandidate(c));
});
