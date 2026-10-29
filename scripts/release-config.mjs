import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const policy = JSON.parse(readFileSync(new URL('../.github/release-policy.json', import.meta.url), 'utf8'));

export function validateConfig(env) {
  assert.ok(['production', 'staging'].includes(env.STAGE));
  assert.equal(env.PLATFORM_ZONE, policy.platformZone, 'Unexpected platform domain');
  assert.equal(env.STORE_ZONE, policy.storeZone, 'Unexpected seller domain');
  assert.equal(env.LEGACY_PLATFORM_ZONE, policy.legacyPlatformZone, 'Unexpected legacy platform domain');
  assert.equal(env.LEGACY_STORE_ZONE, policy.legacyStoreZone, 'Unexpected legacy seller domain');
  assert.equal(env.PLATFORM_NAME, policy.platformName, 'Unexpected product name');
  // Opening accounts or accepting live money requires a separately reviewed policy change.
  assert.equal(env.PUBLIC_ACCESS, env.STAGE === 'production' ? 'waitlist' : 'open', 'Unapproved launch access');
  assert.equal(env.PAYPAL_ENVIRONMENT, policy.paypalEnvironment, 'Live payments are not authorized for this release');
  const prefix = env.STAGE === 'production' ? '' : 'staging.';
  assert.equal(env.BETTER_AUTH_URL, `https://dash.${prefix}${policy.platformZone}`, 'Unexpected auth origin');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateConfig(process.env);
  console.log('Deployment configuration matches the approved launch policy');
}
