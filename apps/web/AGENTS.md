# apps/web

This app runs on **vinext** (the Next.js API on Vite), not Next.js. Next.js documentation applies only where vinext supports the feature. Check support in `../../../refs/stack/vinext/README.md` and `packages/vinext/src/check.ts`, and use the `migrate-to-vinext` skill.

- Alchemy deploys it with `Cloudflare.Website.Vinext` (`packages/infra/alchemy.run.ts`). There is no `wrangler.jsonc`.
- `worker/index.ts` forwards `/api/*` and `/trpc/*` to the api Worker; everything else goes to vinext.
- Server code reads bindings with `import { env } from "cloudflare:workers"`.
