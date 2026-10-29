import { readFileSync } from 'node:fs';
const policy = JSON.parse(readFileSync(new URL('../.github/release-policy.json', import.meta.url), 'utf8'));
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from './release-config.mjs';
const config = { LEGACY_PLATFORM_ZONE: policy.legacyPlatformZone, LEGACY_STORE_ZONE: policy.legacyStoreZone, STAGE: 'production', PUBLIC_ACCESS: 'waitlist', PLATFORM_ZONE: policy.platformZone, STORE_ZONE: policy.storeZone, PLATFORM_NAME: policy.platformName, PAYPAL_ENVIRONMENT: 'sandbox', BETTER_AUTH_URL: `https://dash.${policy.platformZone}` };
test('accepts the approved closed production configuration', () => assert.doesNotThrow(() => validateConfig(config)));
for (const [key, value] of [['PUBLIC_ACCESS', 'open'], ['PUBLIC_ACCESS', ''], ['PLATFORM_ZONE', 'onrender.com'], ['STORE_ZONE', policy.platformZone], ['PAYPAL_ENVIRONMENT', 'live'], ['BETTER_AUTH_URL', `https://dash.staging.${policy.platformZone}`]]) {
  test(`blocks unapproved ${key}=${value} before migration`, () => assert.throws(() => validateConfig({ ...config, [key]: value })));
}
