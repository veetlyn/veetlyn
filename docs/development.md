# Development guide

The practical version of this page is the README's ["Run it locally"](../README.md#run-it-locally); this guide adds the details that bite after the first hour. The architecture reference is [`platform/2026-10-16-architecture.md`](https://github.com/veetlyn/specs/blob/main/platform/2026-10-16-architecture.md) in the private specs repository.

## Prerequisites

Node 24, pnpm 10 (`corepack enable`), Docker (for Postgres). Nothing else — R2, KV and Queues are emulated by `alchemy dev`.

## Environment variables

`pnpm install` runs Varlock, which generates typed accessors from every `.env.schema`. Copy each schema's keys into its ignored sibling and fill the values:

| File | Gets its values from | Notes |
|---|---|---|
| `apps/server/.env` | [PayPal developer](https://developer.paypal.com) sandbox app, [Resend](https://resend.com/api-keys), [AgentMail](https://agentmail.to), Better Auth secret | `RESEND_API_KEY` is optional — without it sign-up works but every send fails. `BETTER_AUTH_URL=http://dash.localhost:3001` locally |
| `apps/web/.env` | `PLATFORM_DOMAIN=localhost`, `PLATFORM_NAME` | web-side public config |
| `packages/db/.env` | your `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/veetlyn_dev` if you followed the README |
| `packages/infra/.env` | Cloudflare account values for `alchemy dev`, `DEV_DATABASE_URL`, `CLOUDFLARE_*` | the deploy token's scopes are listed in the README's "Deploying your own" |
| `.env.test.local` | `TEST_DATABASE_URL` | must point at a database whose name contains `test` |

Never print, commit or share secret values. When a value is missing, the schema's error names the variable — run the failing command again and read it.

## Local hosts

`pnpm dev` serves the site on `localhost:3001`, the dashboard on `dash.localhost:3001` (`admin.localhost` redirects there), and the api Worker's port hosts the tRPC and webhook routes. Host routing is driven by `PLATFORM_DOMAIN=localhost` / `STORE_DOMAIN`, so a seller is `<slug>.localhost:3001` only if you add that hosts entry — plugin development ignores local MCP and targets staging instead (the local `BETTER_AUTH_URL` cannot name an MCP URL a client reaches).

## Database

```bash
pnpm db:generate          # create a migration from schema changes (Drizzle)
pnpm db:migrate:dev       # apply to the dev database
```

Check the dev data before and after a migration that touches it. Migrations are append-only history; write them additive and backfill separately.

## Testing

```bash
pnpm test                        # everything
npx vitest run packages/api/src/routers/payouts.test.ts   # one file
```

Tests run against a **real Postgres** (`TEST_DATABASE_URL`); the global setup migrates and resets it and refuses any database whose name lacks `test`. For a feature branch, make `veetlyn_test_<branch>`:

```bash
docker exec veetlyn-pg createdb -U postgres veetlyn_test_docs
# point .env.test.local's TEST_DATABASE_URL at it
```

Conventions the suite holds: PayPal is faked at `fetch` (no module mocks of the client), routers are tested through `appRouter.createCaller(...)`, seed helpers live in `packages/db/src/testing/db.ts`, and every test names a credible regression. Before each commit: `pnpm check-types && pnpm lint` (lint is Oxlint with the anti-slop plugin at **zero findings**, plus the brand and OSS-boundary checks).

## Code rules (they apply to humans too)

Full list in [`CLAUDE.md`](../CLAUDE.md). The load-bearing ones: untrusted input is decoded with zod at the boundary (no `typeof` checks); money is integer minor units and rates are basis points, rounded half-up once at the line that produces a value; no `console.log`; a `SAFETY:` comment on any type assertion; **no agent moves money** — captures, payouts and refunds always route through a person's approval or an explicit rule.

## Project workflow

- Pull requests target **`dev`**; `main` only receives release merges. Conventional Commits.
- One branch per change; CI must be green before review. Maintainers run the test-audit and security-audit sweeps before a merge; the walkthrough evidence lives in the private specs repository.
- Product designs, plans and the story book live in the separate private `veetlyn/specs` repository, so the public repo carries no specs. Open an issue to discuss a change first.

## Troubleshooting

- **Port already taken after a crash:** find the leftover `workerd`, `vite` or `alchemy` process with `ss -ltnp` and stop it.
- **Blank page / "Invalid hook call" after a dependency change:** two React copies in the web build. Stop dev, delete `apps/web/node_modules/.vite`, restart, clear the browser cache.
- **PayPal popup doesn't open locally:** a known first-restart glitch; reload once. Local PayPal work always uses sandbox accounts.
- **`alchemy dev` can't reach your database:** check `DEV_DATABASE_URL` in `packages/infra/.env` and that the Docker container is up.
