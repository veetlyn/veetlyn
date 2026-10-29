import assert from 'node:assert/strict';

const e = process.env;
assert.ok(e.CLOUDFLARE_API_TOKEN, 'Cloudflare deploy token is missing');
assert.ok(e.CLOUDFLARE_ACCOUNT_ID, 'Cloudflare account is missing');
async function api(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${e.CLOUDFLARE_API_TOKEN}` },
    redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200, `Cloudflare deployment token cannot inspect ${path}`);
  const data = await response.json();
  assert.equal(data.success, true, 'Cloudflare zone access check failed');
  return data.result;
}
for (const name of new Set([e.PLATFORM_ZONE, e.STORE_ZONE])) {
  assert.ok(name, 'Platform and seller zones must be explicit');
  const zones = await api(`/zones?name=${encodeURIComponent(name)}`);
  const zone = zones.find(zone => zone.name === name && zone.account.id === e.CLOUDFLARE_ACCOUNT_ID);
  assert.ok(zone, 'Zone is not visible in the deployment account');
  assert.equal(zone.status, 'active', 'Zone is not active');
  await api(`/zones/${zone.id}/dns_records?per_page=5`);
  await api(`/zones/${zone.id}/workers/routes`);
  console.log(`Deployment token can inspect DNS/routes for ${name}`);
}
// This establishes read visibility before mutation. Actual edit permissions
// are still enforced by Cloudflare when Alchemy applies the reviewed changes.
