# Federated sign-in on auth.payleor.com

- **Status:** design approved in conversation on 2026-10-06; written spec awaiting review
- **Parent specs:** [`2026-10-03-payleor-platform-design.md`](2026-10-03-payleor-platform-design.md) (§4 hosts, §8 MCP, "Domains and email"), [`2026-10-04-public-site-auth-onboarding-design.md`](2026-10-04-public-site-auth-onboarding-design.md) (§5 auth), [`2026-10-05-services-teams-design.md`](2026-10-05-services-teams-design.md) (client pages)
- **Replaces:** the W1-D rule "sign-in stays on the admin host so the auth cookies stay host-only" (W1-D spec §3)
- **Library:** Better Auth 1.7.7 (`refs/stack/better-auth`), packages `better-auth`, `@better-auth/oauth-provider`, `@better-auth/mcp`, `cimd`

## 1. Goal

One Payleor account per person, used everywhere:

- merchants and team members on `admin.payleor.com`, with `payleor.com` knowing who is signed in;
- buyers on stores (`*.payleor.app` and merchants' custom domains), with one account across stores, like Shop;
- services-team clients on their project and pay pages;
- MCP and agent clients (ChatGPT, Claude) calling merchant tools.

All sign-in happens on `auth.payleor.com`, which is also the only host registered with identity providers (PayPal, Discord, and later Google, Apple, Stripe Link).

## 2. Decisions

| Topic | Decision |
|---|---|
| Account model | One `user` per person. The same account can own a store, belong to a services team, buy from stores and be a client. Roles come from memberships, not account types |
| Approach | Hybrid. Our own `*.payleor.com` hosts share one session cookie set for `payleor.com`. Stores and MCP clients are OAuth 2.1 / OIDC clients of `auth.payleor.com` |
| Sign-in methods now | Email and password, one-time email code, Log in with PayPal, Discord |
| Sign-in methods later | Google, Apple, Stripe Link, added as providers on the same host |
| Account linking | PayPal and Discord never link to an existing account by matching email. Linking stays an explicit action from a signed-in account (current rule: no `trustedProviders`) |
| Store clients | One public OAuth client per store, PKCE required, exact redirect URLs per store host |
| Consent | Once per store (and per MCP client), remembered. First-party hosts never see consent |
| Checkout | Guest checkout stays. Sign-in adds saved details and order history only |
| Client links | `/c/{token}` and `/pay/{token}` keep working without an account |

## 3. Hosts, sessions and callbacks

### 3.1 The auth host

- `auth` joins the platform hosts in `packages/core/src/tenancy/target.ts` (`PlatformApp`: `www`, `admin`, `api`, `mcp`, `auth`). `auth` is already a reserved store slug (`slug.ts`).
- The web app rewrites `auth.{PLATFORM_DOMAIN}` to a new route tree `src/app/auth/`. `/api/*` and `/trpc/*` on that host are forwarded to the api Worker as on the admin host.
- Pages on `auth.payleor.com`: `/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password`, `/code` (enter a one-time code), `/consent`, `/signed-out`. They move from the admin route tree; their components (`components/auth/*`) are reused.
- Dev: the tunnel already sends `*.payleor.com` to the web port, so `auth.payleor.com` needs no new ingress rule. `dev-hosts.ts` gains the auth origin for the local stage.

### 3.2 Better Auth settings

- `baseURL: "https://auth.{PLATFORM_DOMAIN}"` (`BETTER_AUTH_URL` becomes the auth origin; the admin origin is derived as `admin.{PLATFORM_DOMAIN}`).
- `advanced.crossSubDomainCookies: { enabled: true, domain: PLATFORM_DOMAIN }`. Cookies keep the `__Secure-` prefix; `__Host-` cannot carry a domain. This is safe because every `*.payleor.com` host is ours; merchant content lives on `payleor.app`.
- `trustedOrigins`: the site, admin and auth origins of the stage. The admin and the site keep calling `/api/auth/*` on their own origin, so there are no cross-origin requests.
- Provider callbacks are pinned with `redirectURI` to `https://auth.{PLATFORM_DOMAIN}/api/auth/callback/{provider}`. These are the only URLs registered with PayPal and Discord.
- Rate limits keep their current rules and add the new endpoints (code send, code verify, OAuth token).

### 3.3 Redirects between hosts

- `admin.payleor.com/login` and `/signup` redirect to `auth.payleor.com/login?next={url}` (and `/signup?next=`). Signed-out admin pages do the same.
- `next` must be an `https` URL whose host is one of the stage's platform hosts (site, admin, auth). Anything else falls back to `https://admin.{PLATFORM_DOMAIN}/`. OAuth flows never use `next`; they return through the registered redirect URL (§4).
- Signing out on any `*.payleor.com` host ends the shared session and revokes the user's store sessions and refresh tokens (§4.3).

## 4. Buyers on stores

### 4.1 OAuth clients per store

- `oauthProvider` (with the `jwt` plugin for signing) runs on the same Better Auth instance. `loginPage` is `/login` and `consentPage` is `/consent` on the auth host. Dynamic client registration stays off.
- Creating a store creates its client on the server (`auth.api.adminCreateOAuthClient`): name and icon from the store, `redirectUris: ["https://{slug}.{STORE_DOMAIN}/auth/callback"]`, public client (`tokenEndpointAuthMethod: "none"`), `requirePKCE: true`, scopes `openid email profile`, `skipConsent: false`, and `referenceId` set to the store id. A one-off backfill creates clients for existing stores.
- Adding a verified custom domain appends `https://{domain}/auth/callback`; removing the domain removes it.
- All storefronts run in our web Worker, so a per-store client secret would protect nothing; PKCE and exact redirect URLs carry the security.

### 4.2 Sign-in flow

1. The buyer clicks "Sign in" on the store. The storefront Worker creates `state` and a PKCE verifier, stores them in a short-lived host-only cookie, and redirects to `https://auth.payleor.com/api/auth/oauth2/authorize`.
2. The buyer signs in on `auth.payleor.com`, or is already signed in through the `payleor.com` cookie.
3. On the first sign-in to that store, the consent page shows "Sign in to {Store} with Payleor. {Store} will see your name and email." The answer is stored per store and user (`oauthConsent`).
4. The browser returns to `/auth/callback` on the store host. The Worker checks `state`, exchanges the code with the verifier, validates the id token (issuer, audience = the store's client id, expiry, nonce) and creates the store session.

### 4.3 Store session and customer record

- The store session cookie is host-only, `HttpOnly`, `Secure`, `SameSite=Lax`, and holds an opaque id. A `store_session` row maps it to the user, the store, the refresh token and an expiry.
- Signing out on the store deletes that row and clears the cookie. Signing out on `auth.payleor.com` deletes every store session of the user and revokes their refresh tokens.
- The first sign-in to a store creates a `store_customer` row (store id, user id, first and last seen). The merchant's customer list reads this table. A store only ever sees what the buyer consented to (name and email), never which other stores the buyer uses.

## 5. Services-team clients

- Private links keep working without an account.
- On `payleor.com`, a signed-in user whose verified email equals the project's client email sees "This is your project" on `/c/{token}`, and the project appears in "Your projects" on `payleor.com/account`.
- A project whose client is a Discord user (no email) is matched by the Discord account id linked to the signed-in user.
- A link is never attached to an account whose email (or Discord id) does not match, so a forwarded link grants nothing beyond the link itself.

## 6. MCP and agent clients

- `auth.payleor.com` is the OAuth 2.1 authorization server for `mcp.payleor.com/mcp`, using `@better-auth/mcp` on top of the same provider. The MCP endpoint publishes protected-resource metadata that names the auth server.
- Agents register through Client ID Metadata Documents (`cimd`): their `client_id` is an HTTPS URL whose document is fetched and validated. Open dynamic registration stays off.
- Scopes: `orders:read`, `orders:write`, `disputes:read`, `disputes:write`, `catalog:read`, `catalog:write`. The consent page names the client and lists the scopes, and the user picks the store or team the token is for. Tokens carry that team, and tools refuse other teams.
- The tools themselves belong to the MCP plan. This spec fixes the server, scopes and team binding so the MCP plan does not rework auth.

## 7. Sign-in methods and accounts

- **Email and password:** unchanged rules (10-character minimum, email verification required, reset links valid one hour).
- **One-time email code:** Better Auth `emailOTP`, 6 digits, valid 5 minutes, sent from `Payleor <accounts@payleor.com>`. A code for an existing email signs into that account; a new email creates an account with the same terms acceptance as signup (`acceptedTermsAt`).
- **PayPal and Discord:** sign in or sign up with the provider's verified email when no account has that email. When an account already has that email, sign-in stops with "An account with this email already exists. Log in, then link PayPal from your account settings." (Discord likewise.)
- **Later providers** (Google, Apple, Stripe Link) follow the PayPal rules.

## 8. Errors

| Case | Behaviour |
|---|---|
| `next` not on an allowed host | Ignored; go to the admin home |
| OAuth `redirect_uri` not registered | The authorize endpoint refuses; the auth host shows "This sign-in link is not valid." |
| Provider error or cancel | Back to `/login` with a plain message |
| Expired or reused one-time code | "This code has expired. Send a new one." |
| Consent denied | The store receives `access_denied` and shows "Sign-in was cancelled." |
| Bad `state`, PKCE or id token at the store callback | No session; "Sign-in failed. Try again." and a log event with the reason |
| Rate limit hit | 429 with the existing messages |

## 9. Testing

- Unit: the `next` allowlist; store client creation, custom-domain add and remove; store callback checks (state, PKCE verifier, id token issuer, audience, expiry, nonce); scope and team binding for MCP tokens.
- Integration (Better Auth test instance, test database): one-time code sign-in and sign-up; PayPal/Discord refusal on an existing email; authorize → consent → token for a store client; consent remembered; sign-out revoking store sessions.
- Walkthrough over the tunnel: admin sign-in through `auth.payleor.com`; the shared session on `payleor.com`; buyer sign-in on a store; consent shown once per store; sign-out everywhere.

## 10. Phasing

| Plan | Scope |
|---|---|
| A1 Auth host (now) | §3 and §7: host routing, pages moved, cookie and origin settings, pinned provider callbacks, one-time email code, admin redirect, sign-out. Lets PayPal and Discord be registered against final URLs |
| A2 Store sign-in | §4: provider and jwt plugins, per-store clients and backfill, consent page, storefront callback and session, `store_customer` |
| A3 Client accounts | §5: `payleor.com/account`, project matching by verified email or Discord id |
| MCP plan | §6: `mcp` and `cimd` on top of A2, scopes and team-bound tokens |

## 11. Settings to change

- `BETTER_AUTH_URL`: `https://auth.payleor.com` when deployed. Local stages derive it from the tunnel domain.
- PayPal app (Log in with PayPal) return URL: `https://auth.payleor.com/api/auth/callback/paypal`.
- Discord application redirect: `https://auth.payleor.com/api/auth/callback/discord`. The interactions endpoint stays `https://api.payleor.com/discord/interactions`.
- The PayPal onboarding return (`/api/paypal/onboarding/return`) stays on the admin origin; it is a partner-referral return, not a sign-in callback. Today `apps/server/src/services.ts` builds it from `BETTER_AUTH_URL`; A1 changes it to the admin origin (`https://admin.{PLATFORM_DOMAIN}`) so it does not move with the auth host.
