# Veetlyn domain cutover

Authorized by Mouhamed, 2026-10-29. Platform: veetlyn.com. Seller sites: veetlyn.app. Both zones are active in the existing Cloudflare account. Registry lookup identifies Dynadot as registrar; Cloudflare DNS activation is complete, registrar transfer is separate.

## Deployment contract

Preserve Worker identities and all existing databases, Hyperdrive, R2, KV, queues, schedules and credentials. New domains become canonical only through reviewed deployment. Retain old platform/API/store hosts and the legacy wildcard DNS resource identity during overlap. Add canonical wildcard DNS and staging route opt-out separately. Root seller domains redirect to the canonical platform, not a registrar parking page.

Legacy GET/HEAD web links redirect temporarily with path/query intact; API calls and OAuth discovery are not marketing redirects. The API normalizes only configured legacy hosts for tenant routing while preserving the actual Origin, method and body. Do not forge Origins or widen trust to arbitrary/custom seller domains. Old sessions do not transfer across registrable domains; reauthentication may be needed. Old OAuth authorizations in flight should finish or restart on the new host.

## Configuration

Update release policy and stage environment variables for canonical/legacy platform/store zones, both store zone IDs, and BETTER_AUTH_URL. Preserve PUBLIC_ACCESS=waitlist on production, open on staging and PayPal sandbox mode. Update only public GitHub variables until provider credentials are validated. The protocol PR #28 is merged; its baseline staging deployment 40881686945 passed.

Private-file R2 CORS temporarily permits old and new platform/dashboard origins. Plugin identifiers stay stable; version 0.3.2 moves public URLs and MCP endpoints to the canonical domain. Existing OAuth clients may need reconnecting to the new issuer/resource; old tokens must not be silently accepted for a new audience.

## Provider readiness

- PayPal management credentials work. Two sandbox webhooks currently target api.veetlyn.com/webhooks/paypal and api.staging.veetlyn.com/webhooks/paypal. Once the new endpoint for each stage is healthy, PATCH the existing webhook's URL only, preserving its ID and event subscriptions. Keep old endpoints available for delayed deliveries. Do not create duplicate subscriptions or move money to test.
- Discord bot access works; the bot application's read response reports no redirect URIs and no interactions endpoint. The supported bot edit API does not support redirect_uris. OAuth portal allowlists need the new dash and dash.staging callback URLs, while preserving existing allowed callbacks until drained. Do not invent user/session credentials or use an unsupported private API.
- Resend domain management works after the owner updated key permissions. veetlyn.com and all four provider-supplied DNS records are verified. Separate domain-scoped sending-only credentials are stored in the staging and production GitHub environments; the setup credential is not used by Workers. Sender configuration changes take effect at deployment. No email delivery test has been performed. Inbound support forwarding remains separate and unconfigured.
- Cloudflare DNSSEC was enabled for both zones and is pending. Because Dynadot is registrar, publish each Cloudflare DS record in Dynadot to complete the delegation chain. Do not claim DNSSEC active based only on zone signing.

## Acceptance and rollback

Run hostname and host-retention tests, release/config cases, types, lint and both release builds. Stage first, check canonical/legacy redirects, real API/database readiness, file CORS, login, seller isolation, metadata, email sender verification and provider callbacks. Promotion requires successful same-tree staging evidence and the owner's walkthrough/recovery record.

Preserve a record of prior Worker version IDs and public configuration. Recover both Workers and their routes/bindings together if needed; code rollback does not undo data or provider configuration. Keep a reverse PayPal URL patch available until cutover is accepted. No datastore recreation, destructive schema change, billing upgrade or registrar transfer is part of this release.

Validation: 27 domain/transport/provenance cases across five files, 25 release/config policy cases, all 16 workspace type checks, lint, actionlint, and both Cloudflare/API release builds passed locally on Node 24. The CI deployment token must inspect all canonical/legacy zones before any migration or deployment mutation; this is a read-visibility preflight, not a claim that read access proves every edit permission.

## Outcome (2026-10-29)

Staging deployed on the Veetlyn hosts (run 40897878834, after the deploy token gained DNS, Workers Routes and Dynamic URL Redirects on both new zones). Mouhamed then chose to end the overlap at once: the old hosts are unbound with no redirects (#30), so traffic, crawling and indexing happen only on veetlyn.com and veetlyn.app. The AI plugin is renamed `veetlyn` (0.4.0); existing installs and connector authorizations are replaced, not carried over.
