# jendal-workspace

Payleor's designs, plans, backlog and progress tracking live in [`specs/`](specs/README.md). Start with [`specs/PROGRESS.md`](specs/PROGRESS.md).

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Next.js, Hono, TRPC, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Next.js** - Full-stack React framework
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Hono** - Lightweight, performant server framework
- **tRPC** - End-to-end type-safe APIs
- **workers** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better-Auth
- **PWA** - Progressive Web App support
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
pnpm install
```

## Database Setup

This project uses PostgreSQL with Drizzle ORM.

1. Make sure you have a PostgreSQL database set up.
2. Update your `apps/server/.env` file with your PostgreSQL connection details.

3. Apply the schema to your database:

```bash
pnpm run db:push
```

Then, run the development server:

```bash
pnpm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
The API is running at [http://localhost:3000](http://localhost:3000).

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@jendal-workspace/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Environment Configuration

Each app owns its environment schema in `.env.schema`. Varlock generates `src/env.ts` during installation; run `pnpm run env:generate` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

Import the generated `ENV` accessor in application code. Shared database and auth packages receive configuration or initialized clients from the application. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

For Cloudflare, Alchemy loads and validates deployment inputs with `varlock/auto-load` in its Node/Bun deployment process. Worker code reads native bindings; web clients use the framework's public env API through `src/env.public.ts` where needed. Alchemy supplies resource URLs and managed database credentials. In-Worker Varlock protections are deferred until an official Alchemy integration is available; see [the non-Wrangler deployment guidance](https://varlock.dev/integrations/cloudflare/#non-wrangler-deploy-tools-alchemy-sst-pulumi).

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

Run standalone Node/Bun tools that use Varlock from the owning app directory so they load that app's schema and env files. `env:generate` only generates TypeScript files; it does not initialize environment values in a subsequent command.

## Deployment

### Alchemy

- Target: web on Cloudflare + server on Cloudflare
- Configure provider accounts: `cd packages/infra && pnpm exec alchemy profile edit`
- Dev: pnpm run dev
- Deploy: `pnpm deploy:staging`, `pnpm deploy:production`

`alchemy profile edit` stores the selected Axiom, Cloudflare, Neon, PlanetScale, and/or Prisma provider profiles under `~/.alchemy`; no provider-specific setup command is required by this scaffold.

Two stages are deployed, with hosts fixed in `packages/infra/deploy-hosts.ts`: `production` (`payleor.com`, `dash.payleor.com`, `api.payleor.com`, `*.payleor.app`) and `staging` (the same hosts under `staging.`). Production deploys after successful CI on `main`; staging deploys after successful CI on `dev` (`.github/workflows/deploy.yml`). Manual deployment also requires the matching branch and stage. From a machine with the deploy settings in `packages/infra/.env`, run `pnpm deploy:staging` or `pnpm deploy:production`. There is no CORS setting: the web Worker reaches the api Worker through a service binding.

No deploy value lives in the repository. Each stage reads its settings from env files that git ignores: `packages/infra/.env` and `apps/server/.env` for what the stages share, and `packages/infra/.env.<stage>.local` for what each stage owns (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `ALCHEMY_PASSWORD`, `PAYPAL_WEBHOOK_ID`). The `.env.schema` files name and document every value. `pnpm -F @jendal-workspace/infra github-env <stage>` copies a stage's values into the GitHub environment of the same name, for the secrets and variables `deploy.yml` reads; it prints names only.

Deploys authenticate with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; an `alchemy profile` OAuth login cannot create the R2 access token the server's file uploads use. The token is an account token with, on the account: Workers Scripts, Workers R2 Storage, Workers KV Storage, Queues, Hyperdrive and Account API Tokens (Edit), Account Settings (Read); on the `payleor.com` and `payleor.app` zones: DNS, Workers Routes and Dynamic URL Redirects (Edit), Zone (Read).

## Project Structure

```
jendal-workspace/
├── apps/
│   ├── web/         # Frontend application (Next.js)
│   └── server/      # Backend API (Hono, TRPC)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Available Scripts

- `pnpm run dev`: Start all applications in development mode
- `pnpm run build`: Build all applications
- `pnpm run dev:web`: Start only the web application
- `pnpm run dev:server`: Start only the server
- `pnpm run check-types`: Check TypeScript types across all apps
- `pnpm run db:push`: Push schema changes to database
- `pnpm run db:generate`: Generate database client/types
- `pnpm run db:migrate`: Run database migrations
- `pnpm run db:studio`: Open database studio UI
- `cd apps/web && pnpm run generate-pwa-assets`: Generate PWA assets

## Launch access and deployments

`main` is production; `dev` is staging for demos and hackathons. Changes reach `main` through pull requests. Successful push CI deploys `dev` to staging and `main` to production. Manual deployments accept only those matching branch/environment pairs. GitHub branch protection must enforce the pull-request policy: workflow files alone cannot forbid direct pushes.

`PUBLIC_ACCESS=waitlist` disables authentication HTTP endpoints, redirects dashboard visitors to `/waitlist`, and replaces account calls to action with the launch mailing list. `PUBLIC_ACCESS=open` enables normal access. Defaults are `waitlist` for production and `open` for staging/local; GitHub environment variables can override them. Both Workers receive the same flag. Changing it requires redeployment.

The launch list stores a normalized unique email and join timestamp in `launch_waitlist`, separately from accounts, after explicit launch-notification consent. The endpoint validates origin/input, rate-limits submissions, and never exposes existing membership. It does not send mail. Launch notification is a later deliberate mailing operation, not an automatic campaign. Use the privacy-policy contact for removal requests and remove waitlist-only addresses after the launch campaign.

## License

AGPL-3.0-only or a separate commercial agreement. Commercial deployments are private-network deployments by default; Payleor Network membership is an optional add-on. See [LICENSING.md](LICENSING.md), including the MIT package exceptions.

Main protection configuration is saved in [.github/main-protection.json](.github/main-protection.json). GitHub rejected enforcement on the current private repository plan (HTTP 403). Once the plan supports it, apply with `gh api --method PUT repos/payleor/payleor/branches/main/protection --input .github/main-protection.json`. It requires a pull request and successful `check`, including for administrators, and forbids force pushes/deletion. Until applied, direct pushes are **not** technically blocked.
