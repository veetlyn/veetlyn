# Public site, auth, onboarding and legal pages

> **Archived:** Built (W1-D, S1); archived 2026-10-16. The stories in `../../stories/` describe the current behaviour.

- **Status:** approved on 2026-10-05
- **Parent spec:** [`2026-10-03-payleor-platform-design.md`](2026-10-03-payleor-platform-design.md) (§4 routing, §5 onboarding, §10 admin)
- **Builds on:** the W1-A plan ([`plans/2026-10-03-w1a-foundations-tenancy.md`](plans/2026-10-03-w1a-foundations-tenancy.md)). Its plan runs after W1-A Task 16.
- **Plan:** [`plans/2026-10-05-w1d-public-site-auth-onboarding.md`](plans/2026-10-05-w1d-public-site-auth-onboarding.md)
- **Library sources:** `../../refs/stack/` (vinext, better-auth, email-sdk 2.0.0)
- **Auth host (2026-10-06):** sign-in moves to `auth.payleor.com` with a session shared across `payleor.com` hosts, replacing the host-only rule in §3. See [`2026-10-06-auth-federation-design.md`](../../platform/2026-10-06-auth-federation-design.md).
- **Email change (2026-10-06):** §5.2 is revised. The first SMTP account (Dynadot) rejected its credentials (`535`), so email moved to Resend. The api Worker uses `createMailer`, which tries the Resend API (`RESEND_API_KEY`), then the Brevo API (`BREVO_API_KEY`), then Brevo's SMTP relay (`smtp-relay.brevo.com:587`), using whichever are configured. The SDK falls back only on a definite "not sent", and it rejects tags for SMTP routes, so `packages/email/src/transport.ts` gives each transport its own client and tries them in turn. Brevo is a fallback only, because it always rewrites links for click tracking. `EMAIL_FROM` is replaced by a sender list in `packages/email/src/senders.ts` plus `EMAIL_DOMAIN` (`payleor.com`) and `EMAIL_REPLY_TO` (`support@payleor.com`). Account emails come from `Payleor <accounts@payleor.com>`. HTTP APIs come before SMTP because SMTP from the deployed edge is at risk: nodemailer connects to an IP and then calls `startTls` with `expectedServerHostname`, which the edge ignores, so no SNI is sent (cloudflare/workerd#6903). Locally, workerd honors it and only logs a `NOSENTRY` warning. The platform domain is now `payleor.com` and stores are on `payleor.app` (platform spec, "Domains and email").

## 1. Goal

A merchant lands on `payleor.app`, reads what Payleor does and what it costs, signs up with email or PayPal, verifies their email, creates a store in one form, and lands on that store's dashboard with a setup checklist. Every platform and store page has the legal pages it needs.

There is one deployment, on the PayPal sandbox. It looks and reads exactly like the live product, prices included. The only differences are that money is fake and a sandbox banner says so. The hackathon rules ask only for the sandbox (`../hackathon/rules.md` §Project requirements), and the instance must stay free and open to judges until Dec 15, 2026.

## 2. Decisions

| Topic | Decision |
|---|---|
| Where pages live | The existing vinext web app, one route tree per host (§3). No separate marketing site |
| Audience | Merchants. Judges see the video and the Devpost testing instructions |
| Pricing shown | Live pricing, Shopify-style (parent spec §6.7): **Starter $12/month + 2% per order, Grow $39 + 1%, Scale $129 + 0.5%**, about 25% less when paid yearly, 14-day free trial. PayPal's own processing fees are separate |
| Sandbox notice | A banner at the top of every page. On checkout pages it also shows the sandbox buyer login and a test card (§4.3) |
| Sign-in methods | Email and password, and Log in with PayPal |
| Email features | Required email verification on sign-up; password reset by email |
| Email sending | `@opencoredev/email-sdk` 2.0.0, SMTP adapter, port 587 with STARTTLS, telemetry off |
| Onboarding | One "Create your store" form, then a setup checklist on the store dashboard |
| Legal | Platform Terms of Service, Privacy Policy and Acceptable Use Policy; four default policies per store |
| Operator | Mouhamed Bakhoum, an individual; Senegalese law; contact bakhoumouhamed@gmail.com |

## 3. Routes

| Host | Route tree | Pages |
|---|---|---|
| `payleor.app` | `src/app/(site)/` (passes through the proxy) | `/` landing, `/legal/terms`, `/legal/privacy`, `/legal/acceptable-use` |
| `admin.payleor.app` | `src/app/admin/` | `/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password`, `/new`, `/` (your stores), `/{storeSlug}` (dashboard) |
| store hosts | `src/app/store/` | `/policies/returns`, `/policies/shipping`, `/policies/terms`, `/policies/privacy` |

- Sign-in stays on the admin host so the auth cookies stay host-only. The landing page's buttons link to `admin.payleor.app/signup`.
- `verify-email`, `forgot-password` and `reset-password` join the reserved slugs (parent spec §4.2; W1-A Task 3 already lists them).
- The scaffold's root page (`src/app/page.tsx`, "API Status") is replaced by the landing page.

## 4. Public site

### 4.1 Landing page (`payleor.app/`)

From top to bottom:

1. **Hero.** One line on what Payleor does: a store that sells to people and to AI shoppers, paid through PayPal. Buttons: "Create your store" (`admin…/signup`) and "See the demo store" (the seeded demo store, parent spec §5).
2. **How it works.** Create your store; connect PayPal; sell on your storefront, in ChatGPT and Claude, and to AI agents.
3. **Features.** Agent checkout protocols (Store Sync, ACP, UCP, AP2); the dispute agent; PayPal payments that go straight to the merchant; several stores per team.
4. **Pricing.** A monthly/yearly toggle and three plan cards (Starter, Grow, Scale) with the price, the per-order fee and the main limits from parent spec §6.7. Each card has a "Start free trial" button (`admin…/signup`). Lines under the cards: "14-day free trial. No setup fee." and "PayPal's processing fees apply and are charged by PayPal." The plan data comes from `core` (the same source as `planFor`), so the page and the billing code cannot disagree.
5. **Closing call to action**, then the footer.

The footer appears on every `(site)` page: links to the three legal pages, the contact address, and "© 2026 Payleor".

Visuals are designed during implementation with the frontend design skills, and copy is checked with the better-writing skill. The landing page is shown to the user before it is committed.

### 4.2 Platform legal pages

The text lives in MDX files under `apps/web/src/content/legal/`; vinext configures `@mdx-js/rollup` when it detects MDX. A shared layout renders each page with its title and "Last updated" date.

Each page names the operator (Mouhamed Bakhoum), the governing law (Senegal) and the contact address, and ends with this note: "This text is a template and is not legal advice."

- **Terms of Service:** what Payleor provides; accounts; plans, the 14-day trial, billing through PayPal Subscriptions, renewal and cancellation, and what happens after a failed payment (7-day grace period, then the store stops selling); the per-order fee for each plan, taken through PayPal's partner fee; merchants contract with PayPal directly, and Payleor is not a payment processor and never holds merchant funds; AI agents never move money without confirmation from a person; intellectual property; suspension and closing an account; the service is provided as is; limits of liability; Senegalese law and the courts of Dakar; how changes are announced.
- **Privacy Policy:** what is collected (account details, store and order data, logs with personal data removed); why; the processors (Cloudflare, Aiven, PayPal, the SMTP provider, AI model providers through Cloudflare AI Gateway); how long data is kept; rights under Law No. 2008-12 on personal data (access, correction, objection, deletion); complaints to the CDP (Commission de Protection des Données Personnelles); transfers outside Senegal; cookies (session cookies only, no tracking).
- **Acceptable Use Policy:** prohibited goods and services, following PayPal's Acceptable Use Policy; fraud and deceptive listings; misuse of agents or the commerce protocols; attacks on, or scraping of, the service; what happens on a breach.

### 4.3 Sandbox banner

`SandboxBanner` is rendered at the top of the root layout, so every host and page shows it. It does not scroll away and cannot be dismissed. Default text: "Sandbox: payments use PayPal test accounts. No real money moves."

On checkout pages (built in a later plan) the banner switches to its `checkout` variant and also shows:

- the sandbox buyer account's email and password, for paying with PayPal
- a test card number, expiry and CVV, for paying by card

These values are sandbox-only and are meant to be public. They still come from settings, not code: `SANDBOX_BUYER_EMAIL`, `SANDBOX_BUYER_PASSWORD`, `SANDBOX_CARD_NUMBER`, `SANDBOX_CARD_EXPIRY`, `SANDBOX_CARD_CVV` on the web Worker. The card comes from the developer dashboard's credit card generator. If any value is missing, the checkout variant shows only the default text.

## 5. Auth

### 5.1 Server (`packages/auth`)

`createAuth(env, db)` from W1-A becomes `createAuth(env, db, { mailer, waitUntil })`. The api Worker builds auth for each request, so it passes `c.executionCtx.waitUntil`.

- **Email and password.** `requireEmailVerification: true`, minimum password length 10. `sendResetPassword` sends a reset link that expires after 1 hour (`resetPasswordTokenExpiresIn: 3600`); `revokeSessionsOnPasswordReset: true`.
- **Email verification.** `sendOnSignUp: true`, `sendOnSignIn: true` (an unverified sign-in attempt sends a fresh link), `autoSignInAfterVerification: true`, `expiresIn: 3600`. The link's callback is `/new`.
- **Sending in the background.** The send callbacks hand the mailer's promise to `waitUntil` and return without awaiting it, so response times do not reveal whether an account exists. `advanced.backgroundTasks.handler` is also `waitUntil` (`refs/stack/better-auth/packages/core/src/types/init-options.ts:502-526`).
- **PayPal sign-in.** PayPal returns `email_verified`, which Better Auth maps to `emailVerified` (`refs/stack/better-auth/packages/core/src/social-providers/paypal.ts:218`), so PayPal users skip verification.
- **Rate limits.** Better Auth's limiter with `storage: "database"`, because Worker memory is not shared between isolates. Custom rules: `/sign-in/email` and `/sign-up/email` 5 per minute; `/request-password-reset` and `/send-verification-email` 3 per 10 minutes.
- **Terms acceptance.** A user additional field `acceptedTermsAt` (date, `input: false`). A `databaseHooks.user.create.before` hook sets it for every new account, whether it signed up by email or with PayPal.

Schema changes: the `rate_limit` table and `user.accepted_terms_at`, in one migration.

### 5.2 Email (`packages/email`, new)

```ts
export interface EmailMessage { to: string; subject: string; text: string; html: string }
export interface Mailer { send(message: EmailMessage): Promise<void> }
```

- `createSmtpMailer(env)` uses `createEmailClient({ adapters: [smtp({ host, port, auth })], telemetry: false })` (`refs/stack/email-sdk/packages/email-sdk/src/core.ts:94`). Port 587 with STARTTLS was checked inside workerd on 2026-10-04; port 465 failed there. The deploy check repeats the test on a deployed Worker.
- `createFakeMailer()` records messages in memory for tests.
- Templates: `verificationEmail({ name, url })` and `passwordResetEmail({ name, url })`. Each returns `{ subject, text, html }`.
- New api Worker settings: `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` (for example `Payleor <no-reply@payleor.app>`).
- The SMTP adapter depends on Nodemailer, so the api Worker keeps the `nodejs_compat` flag.

### 5.3 Pages (admin host)

| Page | Behaviour |
|---|---|
| `/login` | Email and password; "Log in with PayPal"; links to `/signup` and `/forgot-password`. An `EMAIL_NOT_VERIFIED` error sends the user to `/verify-email` |
| `/signup` | Name, email, password; "Sign up with PayPal". On success, `/verify-email` |
| `/verify-email` | "Check your inbox" with the address; a resend button with a 60-second cooldown |
| `/forgot-password` | Email field. Always shows the same confirmation, so it never reveals whether an account exists |
| `/reset-password?token=` | New password twice. On success, `/login` with a confirmation. An invalid or expired token shows a message and a link to `/forgot-password` |

- Above the submit buttons on `/login` and `/signup`: "By continuing you agree to the Terms of Service and the Acceptable Use Policy", linking to `payleor.app/legal/…`.
- A signed-in user who opens an auth page is redirected to `/`. Every other admin page requires a session (`requireSession` from W1-A Task 16).
- The PayPal buttons work only on a public HTTPS host (production or the tunnel), because PayPal requires an HTTPS return URL.

## 6. Onboarding

### 6.1 `/new`: "Create your store"

- Fields: **Store name**, and **Store URL**, shown as `https:// [ acme ] .payleor.site` (the store domain, `STORE_DOMAIN`; W1-A Task 19 builds the field). The address is suggested from the name by `suggestStoreSlug(name)` in `packages/core` until the merchant edits it.
- As the address changes, a debounced (300 ms) `store.checkSlug` query returns `available`, `taken`, or `invalid` with the reason from `validateStoreSlug`.
- Submit calls the `store.create` mutation:
  1. If the user belongs to no organization, create one named after the store, with a random organization slug, and make the user its owner.
  2. Create the store with `auth.api.createTeam`, so the W1-A slug hooks run. `supportEmail` is set to the user's email.
  3. If step 2 fails (for example, the address was taken a moment earlier), the organization stays, and a retry reuses it.
- On success, go to `/{slug}`.

A new store field `supportEmail` (team additional field, `input: false`) is shown in the store policies. W1-C store settings make it editable.

### 6.2 Admin home and checklist

- `/` redirects to `/new` when the user has no stores; otherwise it lists their stores. This replaces W1-A Task 16's `CreateOrganizationForm` and inline store form.
- `setupSteps(store)` in `packages/core` returns `{ id, label, done, href? }[]`. This plan ships three steps: "Create your store" (always done), "Connect PayPal" (done when `paypalMerchantId` is set; W1-B adds its link), and "Visit your storefront" (links to the store's URL). Later plans add "Add your first product" and "Set your branding".
- The store dashboard shows the steps as a checklist with "n of m done".

## 7. Store policies

- Routes: `/policies/returns`, `/policies/shipping`, `/policies/terms`, `/policies/privacy` on every store host, linked from the storefront footer.
- Each is a TSX template under `apps/web/src/content/store-policies/`, filled with the store's name, URL and `supportEmail`, and the date the store was created as "Last updated".
- Defaults: returns within 30 days of delivery, in original condition, refund to the original PayPal payment; shipping covers processing time and delivery, with rates to come from W1-C settings; terms state the store is the seller and Payleor provides the platform; privacy states the store controls its buyers' data and Payleor processes it on the store's behalf.
- Each page ends with the template note from §4.2.
- `storePolicyUrls(storeBaseUrl)` in `packages/core` returns the four URLs, so the ACP and UCP adapters can reuse them for their policy links.

## 8. Errors

- SMTP failure while sending: logged through evlog with the recipient hashed (parent spec §12.1). The user sees the normal confirmation and can use "Resend" on `/verify-email`.
- Rate limit exceeded: the page shows "Too many attempts. Try again in a few minutes."
- `store.create` with a taken or invalid address: the error is shown under the address field.
- An unknown store on a store host returns 404, as in W1-A.

## 9. Testing

- **Unit:** `suggestStoreSlug`, `setupSteps`, `storePolicyUrls`, both email templates, and the sandbox banner's choice of variant when settings are missing.
- **Database (fake mailer):** sign-up sends one verification email; email sign-in is refused before verification; the link from the email verifies and signs in; password reset changes the password and revokes other sessions; `acceptedTermsAt` is set on new users; `store.create` creates the organization once across two stores; `store.checkSlug` returns `available`, `taken` and `invalid`.
- **Manual walkthrough** (added to W1-A Task 17): landing page and pricing; the three legal pages; sign-up; the real verification email; `/new`; the checklist; the four store policies; password reset; PayPal sign-in over the tunnel; the sandbox banner on every host.

## 10. Effects on other plans

- **W1-A:** Task 3 reserves the three new paths (done). Task 16's organization form is replaced by §6.
- **W1-B (PayPal onboarding):** adds the "Connect PayPal" link to `setupSteps`.
- **Checkout plan:** sets the platform fee on each order at the store plan's rate (`planFor`, parent spec §6.7) through PayPal's partner fee (`platform_fees`), and renders the banner's `checkout` variant.
- **Billing plan (Nov 2–8):** adds the admin Billing page, starts the trial when a store is created, and adds a "Choose a plan" step to `setupSteps`.
- **W1-C:** makes `supportEmail` and the shipping rates editable; adds its checklist steps.

## 11. Out of scope

- Editing policy text per store
- Cookie banner (no tracking cookies are set)
- Blog, docs and changelog pages
- Two-factor authentication and passkeys
