# Veetlyn

**Sell where clients ask AI.**

Veetlyn puts a seller's services and products inside Claude and ChatGPT. A client's AI finds the offer, asks questions and requests a quote. The client pays with PayPal on Veetlyn. Agents work within the permissions and business policies assigned to them. In the alpha, buyers approve checkout in PayPal; team payouts follow approval and automation settings.

[Website](https://veetlyn.com) · [Network and plugin](https://veetlyn.com/network) · [License](#license)

> **Status: alpha.** Payments run on the PayPal sandbox while the product is in alpha. veetlyn.com is open to the launch waitlist; the staging deployment is open for testing.

## What it does

- **Quotes and projects.** Clients request work; a team's freelancers ask questions and quote; the client accepts one quote, pays a deposit, follows the delivery and pays the balance.
- **PayPal, done properly.** Orders are created on the server, every payment is approved by the payer in PayPal, webhooks are verified, and refunds and disputes pause what they should.
- **Team payouts.** Payout rules split each payment between members; a person or a rule approves each payout before PayPal sends it.
- **Veetlyn Network.** One connector (`https://api.veetlyn.com/mcp`) lets Claude and ChatGPT search every listed seller, request quotes and follow projects. The alpha connector prepares purchases for buyer approval in PayPal.
- **Your own agents, with limits.** Every action goes through one registry with roles and per-action agent policy: free, needs a person's confirmation, or never.
- **Found in search and in AI.** Seller pages on `<seller>.veetlyn.app` with structured data, open to AI crawlers, plus guided visibility work.

## Use it from your AI assistant

Download the plugin from [veetlyn.com/network](https://veetlyn.com/network#add), or add the connector by hand:

- **Claude:** Customize → Plugins → Upload plugin, or Settings → Connectors → Add custom connector with `https://api.veetlyn.com/mcp`.
- **ChatGPT:** Plugins → Upload, or turn on developer mode and add the same address.

The plugin source is in [`plugins/veetlyn`](plugins/veetlyn/README.md).

## How it is built

```
Claude / ChatGPT ──MCP──┐
                        ▼
browser ──► web Worker (vinext) ──service binding──► api Worker (Hono, tRPC, MCP)
             veetlyn.com, dash.,                       api.veetlyn.com
             *.veetlyn.app                                   │
                                                             ├─► Postgres (Hyperdrive, Drizzle)
                                                             ├─► R2, KV, Queues
                                                             └─► PayPal, Resend, Discord
```

- **Runtime:** Cloudflare Workers. Infrastructure as code with [Alchemy](https://alchemy.run) in `packages/infra/alchemy.run.ts`.
- **Web:** vinext (Next.js on Vite), Tailwind, shadcn/ui primitives in `packages/ui`.
- **API:** Hono, tRPC and an MCP server; Better Auth for sign-in and OAuth for the connector.
- **Data:** PostgreSQL through Hyperdrive, Drizzle ORM and migrations.
- **Config:** [Varlock](https://varlock.dev) schemas (`.env.schema`) in every app; no secret lives in the repository.


### Repository layout

```
apps/
  web/            website, dashboard and seller pages (vinext, one Worker)
  server/         api Worker: tRPC, MCP, webhooks, queues
packages/
  api/            use cases and the action registry
  auth/           Better Auth setup
  core/           domain rules shared by both Workers
  db/             schema, repositories, migrations
  paypal/         PayPal client
  email/          email templates and delivery
  ui/             design tokens and shared components
  infra/          Alchemy stages, hosts and deploy scripts
  oss/            standalone MIT packages (rules engine, outbox, scheduler)
plugins/veetlyn/  the Claude and ChatGPT plugin
```

## Run it locally

You need Node 24, pnpm 10 and Docker.

```bash
pnpm install                       # also generates the typed env accessors

# Postgres for development
docker run -d --name veetlyn-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:17
docker exec veetlyn-pg createdb -U postgres veetlyn_dev
```

Fill the ignored env files from their schemas: `apps/server/.env` (see `apps/server/.env.schema`) and `packages/infra/.env`. Set `DEV_DATABASE_URL` (in `packages/infra/.env`) to the database above. PayPal values come from a [PayPal developer](https://developer.paypal.com) sandbox app.

```bash
pnpm db:migrate:dev                # migrate the dev database
pnpm dev                           # site on localhost:3001, dashboard on dash.localhost:3001
```

Alchemy emulates R2, KV and Queues locally.

## Checks

```bash
pnpm check-types
pnpm lint          # Oxlint with the anti-slop plugin, plus the brand and OSS-boundary checks
pnpm test          # Vitest; needs TEST_DATABASE_URL in .env.test.local, on a database whose name contains "test"
```

CI runs all three, a secret scan and the release builds on every pull request.

## AI plugin builds

Built plugin zips are never committed.

- `pnpm plugin:zip` and `pnpm plugin:zip:staging` write the Claude and ChatGPT zips to `dist/plugin/`.
- The **AI plugin** workflow builds both stages on every change to `plugins/` and keeps them as the `ai-plugin-zips` artifact.
- Each deploy builds the downloads for its own stage into the website, served at `/plugin/claude.zip` and `/plugin/chatgpt.zip`.

## Deploying your own

Two stages are deployed from GitHub Actions: `staging` (after CI passes on `dev`) and `production` (an owner-approved dispatch from `main`, with verified staging evidence for the same tree).

Hosts are derived from two zones in `packages/infra/deploy-hosts.ts`: the platform zone (site, `dash.`, `api.`) and the seller zone (`*.` seller pages). Only production is indexed by search engines; other stages send `noindex`.

Deploys use `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token needs, on the account: Workers Scripts, Workers R2 Storage, Workers KV Storage, Queues, Hyperdrive and Account API Tokens (Edit), Account Settings (Read); on both zones: DNS, Workers Routes and Dynamic URL Redirects (Edit), Zone (Read).

Stage values live in ignored files (`packages/infra/.env`, `packages/infra/.env.<stage>.local`) and in the GitHub environment of the same name; `pnpm -F @jendal-workspace/infra github-env <stage>` copies them and prints names only. `PUBLIC_ACCESS=waitlist` closes sign-up and sign-in behind a launch list; `open` opens them.

Branch protection for `main` is saved in [`.github/main-protection.json`](.github/main-protection.json); reapply it with `gh api --method PUT repos/veetlyn/veetlyn/branches/main/protection --input .github/main-protection.json`.

## Contributing

- Open pull requests against `dev`, the default branch. `main` only receives release merges.
- Use [Conventional Commits](https://www.conventionalcommits.org).
- Keep `pnpm check-types`, `pnpm lint` and `pnpm test` green; lint must stay at zero findings.
- Read [`CLAUDE.md`](CLAUDE.md) for the code rules (money in integer minor units, untrusted input decoded with zod, no agent moves money without a person). They apply to people too.
- Product designs and plans are kept in a separate private repository. Open an issue to discuss a change before building it.

## Security

Please do not open public issues for vulnerabilities. Report them privately to the maintainer through GitHub ([@Mouhamed-B](https://github.com/Mouhamed-B)). The app only touches the PayPal sandbox today.

## License

Veetlyn is open core:

- Everything outside `ee/` is [AGPL-3.0-only](LICENSE), or available under a commercial agreement.
- [`ee/`](ee/README.md) holds the enterprise features under the [Veetlyn Enterprise License](ee/LICENSE): free to develop and test, a commercial agreement for production.
- Standalone packages in `packages/oss/` are MIT.

Details are in [LICENSING.md](LICENSING.md). The Veetlyn name and logo are not licensed by any of these licenses.

If this project helps you, you can [sponsor it](https://github.com/sponsors/Mouhamed-B).
