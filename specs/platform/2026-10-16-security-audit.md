# Payleor security audit

**Date:** 2026-10-16. **Status:** reviewed 2026-10-16 (A4 corrected, owners added); findings open, filed in [`BACKLOG.md`](../BACKLOG.md). **Scope:** the code on `main` at `27c26b9` and the throwaway `spike-plugin` branch at `92dcbef` (not merged; its four items feed run C — two of them are already addressed by the [run C design](2026-10-15-c-plugin-design.md)). **Method:** the securebydesign skill's 25 controls (v1.1.0; the skill's upstream repo 404s, so freshness is unverified). **Result:** 0 critical, 0 high; 7 hardening items against `main`, 4 against the spike branch.

The review walked the security-critical paths in both worktrees — auth, webhooks, money flows, payouts, uploads, tenancy, the MCP spike, infra and CI. Shared code was audited once. Paths below are repo-relative.

## Summary

| Controls | Pass | Partial | Fail | N/A |
|---|---|---|---|---|
| 25 | 15 | 8 | 0 | 2 |

No critical or high vulnerabilities were found. The money paths, webhook verification and multi-tenant authorization are unusually disciplined — amount equality checks, row locks, idempotent capture facts, deny-by-default grants. The findings below are hardening items, most in the spike branch's newest code.

## A. Findings on `main`

### A1. [Low] CSV formula injection in the Payouts Web export — SBD-01, SBD-03

**Evidence:** `packages/core/src/payouts/payouts-web.ts:22-24` — `csvCell` quotes `"`, `,` and CR/LF but does not neutralize `= + - @` prefixes. The `note` column embeds the user-settable team name (`payouts-web.ts` — `Payout from ${team.name} via Payleor`). Admins open this CSV in Excel/Sheets before uploading it to PayPal.

**Remediation:** Prefix `'` (or a space) when a cell starts with `=`, `+`, `-`, `@`, tab or CR. Only `note` carries user text (receiver, amount, currency and reference are system values), and PayPal shows the note to the recipient, so the prefix appears in their payout note; alternatively, strip those leading characters from the team name in the note.

### A2. [Low] Image downloader buffers the whole body before the size check — SBD-11, SBD-12

**Evidence:** `apps/server/src/catalog/image-downloader.ts:13-14` — `arrayBuffer()` then compare against `MAX_IMAGE_BYTES`. The 10s timeout bounds time, not memory.

**Remediation:** Read through `response.body` and abort past `MAX_IMAGE_BYTES`. Also confirm the content type is validated before storage; this layer passes through what remote hosts claim.

### A3. [Low] CI and supply-chain scanning gaps — SBD-14, SBD-15

**Evidence:** `.github/workflows/ci.yml` — `actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v4` are pinned to mutable tags, not commit SHAs; there is no `permissions:` block; no dependency audit (`pnpm audit`) and no secret scanning (gitleaks) step. The lockfile is committed — good.

**Remediation:** Pin actions to commit SHAs, add `permissions: contents: read`, add the audit and gitleaks steps.

### A4. [Low] Security headers unverified; sandbox banner is unconditional — SBD-03

**Evidence:** No CSP/HSTS set in web or worker code; the deployment is Alchemy → Cloudflare, so headers may exist at the edge but cannot be confirmed from the repo (a theatre-check gap, not a proven absence). Separately, `apps/web/src/app/layout.tsx:33` renders `SandboxBanner` unconditionally. The layout uses the default variant, which shows only the notice; the `SANDBOX_*` buyer and card values appear only in the checkout variant (`apps/web/src/lib/sandbox-banner.ts`), which no page renders yet (a separate H backlog row asks for it on the pay page). The risk is the notice itself: on a live deployment it would tell buyers that no real money moves. (Corrected in review: the first draft said test credentials would show site-wide.)

**Remediation:** Declare the header set explicitly (worker middleware or documented CDN rule) and render the banner only when `PAYPAL_ENVIRONMENT === "sandbox"` (the value exists in `apps/server/src/env.ts`; the web Worker needs it too). (The `SANDBOX_*` values are intentionally public sandbox test data — not a secret leak.)

### A5. [Informational] Hygiene, two items

- `packages/api/src/use-cases/orders.ts:486` — `verifyCheckout` compares token hashes with `!==` (non-constant-time). Impractical to exploit with 256-bit secrets; use a timing-safe compare for hygiene.
- `README.md` still tells deployers to set `CORS_ORIGIN`, which exists nowhere in code — the service-binding design makes CORS moot. Remove the line so nobody "fixes" it by adding permissive CORS.

## B. Findings on the `spike-plugin` branch (input for run C)

### B1. [Medium] Consent screen trusts an attacker-chosen client name — SBD-05

**Evidence:** `packages/auth/src/index.ts` — `allowDynamicClientRegistration` and `allowUnauthenticatedClientRegistration`. The consent page renders `client_name` fetched from the freshly-registered client record (`apps/web/src/app/admin/oauth/consent/consent-form.tsx`) plus raw scope strings. Rate limiting is present, not missing: the spike observed the limiter refuse a registration burst with 429 ([plugin spike facts](2026-10-14-plugin-spike-facts.md) §Answers 1), and the [run C design](2026-10-15-c-plugin-design.md) already plans a "rate-limited DCR fallback".

**Risk:** anyone can register a client named "Payleor Sync" with a redirect URI they control and route a victim through `/api/auth/oauth2/authorize` on the admin host; after approval the attacker holds tokens that act as that user through `/mcp`. It is consent-phishing riding a first-party UI — the check performed is real, the displayed identity is not verifiable.

**Remediation:** on the consent screen, show the client's **redirect URI host** (the real trust anchor), not just `client_name`; periodically purge registered-but-unused clients.

**Stronger option, a decision for Mouhamed:** both target hosts register through CIMD (Claude and ChatGPT, proven in the spike: [plugin spike facts](2026-10-14-plugin-spike-facts.md) §Answers 1), and CIMD is allowlisted to `claude.ai` and `chatgpt.com`. Turning DCR off (`allowDynamicClientRegistration: false`) removes this risk entirely; the cost is that MCP clients without CIMD cannot connect. That changes the run C design's "rate-limited DCR fallback".

### B2. [Medium-Low] Seller-controlled strings are interpolated into the model's conversation — SBD-17 (LLM01)

**Evidence:** `apps/server/src/mcp/widget.ts` — `tellModel("The user pressed Request a quote on " + o.name + " by " + o.seller + …)` and `sendMessage("I'd like a quote for " + o.name …)`. Offering names, team names, descriptions and delivery notes are seller-chosen.

**Risk:** prompt injection from listing content (an offering named to make the model claim a payment happened, or nudge the user toward the wrong offering). Blast radius is contained: commitments require card-button HMAC confirmations and server re-validation, the widget renders data as text nodes, and the connector guidelines already reject prompt-injection patterns in descriptions (`2026-10-14-connector-ux-guidelines.md` §Review rejects). The injection channel is the conversation itself.

**Remediation:** in widget v2, frame these as data ("the offering titled «…»"), strip control characters, cap lengths, and prefer `updateModelContext` structured payloads over instruction-position text.

### B3. [Informational] The widget bridge loads from unpkg at runtime — SBD-16-adjacent

**Evidence:** `apps/server/src/mcp/widget.ts` — `https://unpkg.com/@modelcontextprotocol/ext-apps@2.0.3/…` with `unpkg.com` in `WIDGET_CSP_DOMAINS`. Version-pinned URL, but a third-party CDN executes inside a host-rendered iframe. The [run C design](2026-10-15-c-plugin-design.md) §Widget v2 already resolves this: "the bridge is bundled or served from our origin, not unpkg". Recorded here as the spike's state only.

### B4. [Informational] `console.log("SPIKE_RPC", …)` in the MCP route

**Evidence:** `apps/server/src/mcp/spike.ts` — logs method/version/user-agent/tool name, bypassing evlog. Spike artifact; drop it in run C.

## Passed controls (evidence)

- **SBD-01/03 Input & output:** zod at every boundary; 1MB webhook body limit; upload extension allowlist with bidi/control-char stripping; presigned PUT signs `content-type` + `content-length`; SVG downloads forced `application/octet-stream` + `attachment` disposition; email HTML escaped with CRLF-stripped subjects. No `eval`/`innerHTML`/`dangerouslySetInnerHTML` anywhere.
- **SBD-04 Auth:** Better Auth defaults (scrypt-class hashing — not byte-verified), min password 10, mandatory email verification, DB-backed rate limits (5/min sign-in, 3/10min reset), 1h reset token, session revocation on reset, `cf-connecting-ip` only.
- **SBD-05/06 Authorization & least privilege:** deny-by-default grant engine (`packages/api/src/actions/perform.ts`); foreign teams 404 as missing; MCP client checks exclude seller-team members; payouts admin ops require `approve_payouts`; member payout requests bounded by ledger balance with a one-open-request slot. R2 S3 credentials are read-write but scoped to one bucket (needed for presign) — accepted.
- **SBD-07/08 Crypto:** AES-256-GCM + random IV + `team.id` as AAD for payout secrets; `PAYOUT_CREDENTIALS_KEY` separate from `BETTER_AUTH_SECRET`; HMAC link tokens domain-separated by label; 32-byte `getRandomValues` tokens, SHA-256 at rest; MCP confirmation tokens bound to action + user + project + target with TTL. No hardcoded secrets in tracked files (pattern sweep clean).
- **SBD-09/10 Data minimization & logging:** PayPal webhook payloads not persisted (ids only); recipient emails hashed in logs; PayPal error details trimmed to issue/field; DB errors reduced to name/code/constraint; `isDev: false`; action log retention 180 days (the PayPal dispute window).
- **SBD-11 Rate limiting:** checkout start/capture limited per-IP **and** per-order for capture; request limits table; Better Auth custom rules.
- **SBD-12 SSRF:** CIMD fetch restricted to `claude.ai`/`chatgpt.com`, https-only, redirects refused; image downloader https-only; Workers egress blocks private ranges.
- **SBD-13 Errors:** generic client messages; 5xx-only server logging for tRPC.
- **SBD-19 LLM output:** no LLM output reaches execution, the database or the browser; MCP tools validate everything server-side.
- **SBD-20 Network:** the API is reached only through the web Worker's service binding with first-party cookies; no CORS surface.
- **SBD-21 Design:** fail-secure, idempotency keys on every PayPal POST, capture-fact conflicts park for humans instead of guessing, amount + currency equality checks (`packages/api/src/use-cases/payments.ts`, `orders.ts`).
- **Webhook verification:** PayPal verify-webhook-signature postback with raw-body echo (`packages/paypal/src/webhooks.ts`); Discord Ed25519 with strict hex validation (`apps/server/src/discord/verify.ts`). Both correct.
- **N/A:** SBD-16 (no models downloaded), SBD-18 (no RAG/embeddings).

## Priority order

Owners use the runs of the [agentic dash design](2026-10-16-agentic-dash-design.md) §10: the plugin port is run L (formerly part of run C).

1. **B1** consent screen shows the redirect host, or DCR off (above) — L, in the OAuth port
2. **B2** widget v2 frames seller strings as data — L; the same rule applies to briefs and messages given to the intake agent (design §8)
3. **A1** CSV formula neutralization — quick; H
4. **A2** image downloader streaming cap — quick; H
5. **A3** CI: SHA-pinned actions, `permissions`, audit + gitleaks — H, with the deploy workflow
6. **A4/A5** headers declared, sandbox banner gate, timing-safe compare, README `CORS_ORIGIN` line — H; **B3/B4** — L

The agent features (G, C, D) add a new surface: model calls on untrusted text with tools behind `perform`. Re-run this audit on them before the freeze.

## Scope of assurance

This analysis covers known vulnerability patterns in the code and architecture provided. It does not replace penetration testing, formal threat modeling, or a certified audit for systems handling sensitive or regulated data. Not reviewed line-by-line: all ~700 source files, migration snapshots, UI polish, and live deployment configuration (TLS, WAF, edge headers). The `spike-plugin` branch is throwaway and will not merge; its items matter only as run C input.
