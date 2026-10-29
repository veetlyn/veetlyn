import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const stage = process.env.STAGE;
assert.ok(['staging', 'production'].includes(stage));
assert.match(process.env.RELEASE_SHA || '', /^[a-f0-9]{40}$/);
const prefix = stage === 'staging' ? 'staging.' : '';
const platform = `${prefix}${process.env.PLATFORM_ZONE}`;
const stores = `${prefix}${process.env.STORE_ZONE}`;
const origin = `https://${platform}`;
const hash = value => createHash('sha256').update(value).digest('hex');
async function request(url, init = {}) {
  const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  return response;
}
async function verify() {
  const descriptors = [];
  for (const [service, host] of [['web', platform], ['api', `api.${platform}`]]) {
    const response = await request(`https://${host}/.well-known/release`);
    assert.equal(response.status, 200, `${service} revision unavailable`);
    const data = await response.json();
    const { workerVersion, ...configuration } = data;
    assert.match(workerVersion || "", /^[a-f0-9-]{36}$/, "Missing deployed Worker version ID");
    assert.deepEqual(configuration, {
      service, sha: process.env.RELEASE_SHA, stage,
      publicAccess: process.env.PUBLIC_ACCESS, platformName: process.env.PLATFORM_NAME,
      platformDomain: platform, storeDomain: stores,
      paypalEnvironment: process.env.PAYPAL_ENVIRONMENT,
    }, `${service} revision/configuration mismatch`);
    descriptors.push(data);
  }
  const storeRoot = await request(`https://${stores}/`);
  assert.equal(storeRoot.status, 307, 'Seller root must not serve a parking page');
  assert.equal(storeRoot.headers.get('location'), `${origin}/`);
  const homepage = await request(origin);
  assert.equal(homepage.status, 200, 'Landing page failed');
  const html = await homepage.text();
  assert.ok(html.includes(process.env.PLATFORM_NAME), 'Brand missing');
  const waitlist = await request(`${origin}/waitlist`);
  assert.equal(waitlist.status, 200, 'Waitlist page failed');
  assert.ok((await waitlist.text()).includes('Join the waitlist'));
  for (const path of ['/dash', '/admin', '/store']) {
    assert.equal((await request(`${origin}${path}`)).status, 404, 'Internal route leaked through platform host');
  }
  const icon = await request(`${origin}/favicon/favicon.svg`);
  assert.equal(icon.status, 200);
  assert.equal(hash(Buffer.from(await icon.arrayBuffer())), hash(readFileSync('apps/web/public/favicon/favicon.svg')), 'Wrong favicon revision');
  const api = `https://api.${platform}`;
  assert.equal((await request(`${api}/health/ready`)).status, 200, 'API/database readiness failed');
  if (process.env.PUBLIC_ACCESS === 'waitlist') {
    for (const path of ['/login', '/signup']) {
      const response = await request(`${origin}${path}`);
      assert.ok([301, 302, 303, 307, 308].includes(response.status), 'Authentication page was exposed');
      assert.equal(new URL(response.headers.get('location'), origin).href, `${origin}/waitlist`);
    }
    const dash = await request(`https://dash.${platform}/`);
    assert.ok([301, 302, 303, 307, 308].includes(dash.status));
    assert.equal(new URL(dash.headers.get('location'), origin).href, `${origin}/waitlist`);
    for (const host of [platform, `api.${platform}`]) {
      for (const path of ['/api/auth/sign-in/email', '/api/auth/sign-up/email', '/api/auth/get-session']) {
        const response = await request(`https://${host}${path}`, { method: path.endsWith('get-session') ? 'GET' : 'POST' });
        assert.equal(response.status, 403, 'Authentication API was exposed');
        assert.equal((await response.json()).error, 'launch_pending');
      }
    }
    assert.ok(!html.includes('aria-label="Sandbox notice"'), 'Sandbox banner exposed');
  } else {
    assert.equal((await request(`https://dash.${platform}/api/auth/get-session`)).status, 200, 'Staging authentication unavailable');
  }
  return descriptors;
}
let descriptors;
for (let attempt = 1; attempt <= 6; attempt++) {
  try { descriptors = await verify(); break; }
  catch (error) {
    console.error(`Smoke verification attempt ${attempt}: ${error.message}`);
    if (attempt === 6) throw error;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
const sha = process.env.RELEASE_SHA;
const tree = execFileSync('git', ['rev-parse', `${sha}^{tree}`], { encoding: 'utf8' }).trim();
const migrations = readdirSync('packages/db/src/migrations').filter(name => name.endsWith('.sql')).sort().map(name => ({ name, sha256: hash(readFileSync(`packages/db/src/migrations/${name}`)) }));
const policy = JSON.parse(readFileSync('.github/release-policy.json', 'utf8'));
const previousResponse = await fetch(`https://api.github.com/repos/${policy.repository}/releases/latest`, {
  headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
  signal: AbortSignal.timeout(15000),
});
assert.ok(previousResponse.ok || previousResponse.status === 404, 'Cannot establish previous release');
const previous = previousResponse.ok ? await previousResponse.json() : null;
writeFileSync('release.json', JSON.stringify({ stage, sha, tree, verified: true,
  runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  workflowUrl: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  operator: process.env.GITHUB_ACTOR, verifiedAt: new Date().toISOString(),
  configFingerprint: hash(JSON.stringify(descriptors)), descriptors,
  migrations, previousRelease: previous ? { tag: previous.tag_name, url: previous.html_url } : null,
  version: process.env.RELEASE_VERSION || null, recoveryUrl: process.env.RECOVERY_URL || null,
}, null, 2));
console.log(`Verified ${stage} release ${sha}`);
