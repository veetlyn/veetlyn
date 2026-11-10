import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const policy = JSON.parse(readFileSync(new URL('../.github/release-policy.json', import.meta.url), 'utf8'));

export function validateConfig(env) {
  assert.ok(['production', 'staging'].includes(env.STAGE));
  assert.equal(env.PLATFORM_ZONE, policy.platformZone, 'Unexpected platform domain');
  assert.equal(env.STORE_ZONE, policy.storeZone, 'Unexpected seller domain');
  assert.equal(env.PLATFORM_NAME, policy.platformName, 'Unexpected product name');
  // Opening accounts or accepting live money requires a separately reviewed policy change.
  assert.equal(env.PUBLIC_ACCESS, env.STAGE === 'production' ? 'waitlist' : 'open', 'Unapproved launch access');
  assert.equal(env.PAYPAL_ENVIRONMENT, policy.paypalEnvironment, 'Live payments are not authorized for this release');
  const prefix = env.STAGE === 'production' ? '' : 'staging.';
  assert.equal(env.BETTER_AUTH_URL, `https://dash.${prefix}${policy.platformZone}`, 'Unexpected auth origin');
  validateBilling(env);
}

// Selling pauses two days after a trial ends without a subscription. A stage open to sellers must therefore let them
// subscribe, or every seller is stopped on day 16 with no way to pay. Billing is all three Polar values or none, and it
// charges real cards only alongside live client payments.
export function validateBilling(env) {
  const values = [env.POLAR_SERVER, env.POLAR_ACCESS_TOKEN, env.POLAR_WEBHOOK_SECRET];
  const configured = values.every(Boolean);
  assert.ok(configured || values.every((value) => !value), 'Billing is half configured: set POLAR_SERVER, POLAR_ACCESS_TOKEN and POLAR_WEBHOOK_SECRET together');
  if (env.PUBLIC_ACCESS === 'open') assert.ok(configured, 'A stage open to sellers needs billing, or selling pauses when trials end');
  if (configured) {
    assert.ok(['sandbox', 'production'].includes(env.POLAR_SERVER), 'Unexpected billing server');
    if (env.PAYPAL_ENVIRONMENT !== 'live') assert.equal(env.POLAR_SERVER, 'sandbox', 'Live billing is not authorized while client payments are sandbox');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateConfig(process.env);
  console.log('Deployment configuration matches the approved launch policy');
}
