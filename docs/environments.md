# Environments: local, staging, production

Veetlyn runs the same code on three stages. All payment flows use the **PayPal sandbox** on every stage — no real money moves anywhere.

| | Local | Staging | Production |
|---|---|---|---|
| Purpose | Developing | Demos, judges, trying the product | The public alpha |
| Hosts | `localhost:3001`, `dash.localhost:3001`, `api.localhost` (see below) | `staging.veetlyn.com`, `dash.staging.veetlyn.com`, `api.staging.veetlyn.com`, `<seller>.staging.veetlyn.app` | `veetlyn.com`, `dash.veetlyn.com`, `api.veetlyn.com`, `<seller>.veetlyn.app` |
| MCP connector | not reachable by a client (see [ai-plugin.md](ai-plugin.md)) | `https://api.staging.veetlyn.com/mcp` | `https://api.veetlyn.com/mcp` |
| Sign-up / sign-in | open | **open** — create an account freely | **waitlist only** (`PUBLIC_ACCESS=waitlist`): sign-up and sign-in redirect to the launch list |
| Search engines | — | `noindex` | indexed (the alpha's SEO is live) |
| Who deploys it | you (`pnpm dev`) | automatic: every push to `dev` that passes CI | owner-dispatched release from `main` |
| Data | your own Docker Postgres | shared sandbox data; seeded demo data is marked as demos | its own database, made by real usage |

## Which one do I use?

- **Building or reviewing code:** run local. Nothing you do can affect anyone else.
- **Trying the product, walking a flow, judging it:** use staging. It is the working app in test mode; sign up on `dash.staging.veetlyn.com` and connect your own PayPal developer sandbox accounts.
- **Showing the product:** staging again — production is the waitlist face on purpose. The alpha story is "test mode now, launch list open".
- **Real sellers:** none yet — the launch waitlist on [veetlyn.com](https://veetlyn.com) is notified when the alpha opens to them.

## Staging: the demo and sandbox lane

- **Open by design.** Staging runs with `PUBLIC_ACCESS=open`, so the whole flow — sign-up, seller setup, quoting, checkout, payouts — is self-serve. Every PayPal step uses sandbox accounts from [developer.paypal.com](https://developer.paypal.com).
- **Deployed automatically.** A push to `dev` runs CI (types, lint, tests, secret scan) and deploys staging when it passes. Never deploy by hand over it; if the branch's CI is red, staging is already behind.
- **Shared, not sacred.** Staging data is shared sandbox data. Seed what a demo needs and mark it as a demo. A fix that judges need goes through the normal staging lane (a PR to `dev`), not a hand deploy.
- **Private paths stay private.** Client links (`/c/…`, `/pay/…`) and order pages are signed links; they are excluded from the seller pages' `robots.txt` and `sitemap.xml`.

## Production: the waitlist alpha

- `PUBLIC_ACCESS=waitlist` closes the dashboard behind the [launch waitlist](https://veetlyn.com/waitlist); the marketing site, legal pages and the waitlist form are public.
- Releases follow the [release protocol](https://github.com/veetlyn/veetlyn/blob/main/README.md#deploying-your-own): a release PR from `dev` to `main`, verified staging evidence for the same tree, an owner-approved dispatch, and a version tag (`vX.Y.Z-alpha.N`).
- Only production is indexed; seller pages additionally require the seller to be active before they serve `robots.txt`/`sitemap.xml`/`llms.txt` and openGraph metadata.

## Configuration

Every stage reads its config from [Varlock](https://varlock.dev) `.env.schema` files — `apps/server/.env.schema`, `apps/web/.env.schema`, `packages/db/.env.schema`, `packages/infra/.env.schema` — with values in ignored env files locally and in the GitHub environments `staging` and `production` when deployed. The keys that decide the stage shape:

| Variable | Effect |
|---|---|
| `PUBLIC_ACCESS` | `waitlist` (production) or `open` (staging) — gates sign-up/sign-in |
| `PLATFORM_DOMAIN` / `STORE_DOMAIN` | host routing: the platform zone and the seller zone |
| `PLATFORM_NAME` | the product name people read in UI, email and the plugin |
| `PAYPAL_ENVIRONMENT` | `sandbox` everywhere today; `live` is the switch for real money |
| `DEPLOY_STAGE` | set by the deploy; names the stage in logs |

Secrets never enter the repository: see [development.md](development.md#environment-variables) for where the ignored files live.
