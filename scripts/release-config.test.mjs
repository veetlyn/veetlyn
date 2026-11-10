import { readFileSync } from 'node:fs';
const policy = JSON.parse(readFileSync(new URL('../.github/release-policy.json', import.meta.url), 'utf8'));
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from './release-config.mjs';
const config = { STAGE: 'production', PUBLIC_ACCESS: 'waitlist', PLATFORM_ZONE: policy.platformZone, STORE_ZONE: policy.storeZone, PLATFORM_NAME: policy.platformName, PAYPAL_ENVIRONMENT: 'sandbox', BETTER_AUTH_URL: `https://dash.${policy.platformZone}` };
test('accepts the approved closed production configuration', () => assert.doesNotThrow(() => validateConfig(config)));
for (const [key, value] of [['PUBLIC_ACCESS', 'open'], ['PUBLIC_ACCESS', ''], ['PLATFORM_ZONE', 'onrender.com'], ['STORE_ZONE', policy.platformZone], ['PAYPAL_ENVIRONMENT', 'live'], ['BETTER_AUTH_URL', `https://dash.staging.${policy.platformZone}`]]) {
  test(`blocks unapproved ${key}=${value} before migration`, () => assert.throws(() => validateConfig({ ...config, [key]: value })));
}

const billing = { POLAR_SERVER: 'sandbox', POLAR_ACCESS_TOKEN: 'token', POLAR_WEBHOOK_SECRET: 'secret' };
const staging = { ...config, STAGE: 'staging', PUBLIC_ACCESS: 'open', BETTER_AUTH_URL: `https://dash.staging.${policy.platformZone}` };
test('accepts the staging configuration with sandbox billing', () => assert.doesNotThrow(() => validateConfig({ ...staging, ...billing })));
test('accepts a closed production stage without billing', () => assert.doesNotThrow(() => validateConfig(config)));
test('blocks a stage open to sellers without billing', () => assert.throws(() => validateConfig(staging), /needs billing/));
test('blocks half-configured billing', () => assert.throws(() => validateConfig({ ...config, POLAR_ACCESS_TOKEN: 'token' }), /half configured/));
test('blocks live billing while client payments are sandbox', () =>
  assert.throws(() => validateConfig({ ...staging, ...billing, POLAR_SERVER: 'production' }), /Live billing/));
