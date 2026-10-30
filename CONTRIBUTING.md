# Contributing to Veetlyn

Thanks for helping. Veetlyn is open core: the code outside `ee/` is AGPL-3.0, the standalone packages in `packages/oss/` are MIT, and `ee/` is free to develop against (see [LICENSING.md](LICENSING.md)).

## Before you build

- Open or comment on an **issue** describing the change before writing it. Product designs and plans live in a separate private repository, so context you're missing may already be decided — an issue is the cheap way to find out.
- Security issues are **not** for public issues: report privately per [the README](README.md#security).

## Getting set up

Follow the README's ["Run it locally"](README.md#run-it-locally); [docs/development.md](docs/development.md) covers environment variables, the test database, migrations and troubleshooting in detail. You need Node 24, pnpm 10 and Docker.

## Making the change

1. **Branch from `dev`** — the default branch and integration branch. `main` only receives release merges; never open a PR against it.
2. **One branch per change**, named after what it does (`fix/…`, `feat/…`, `docs/…`).
3. **Conventional Commits** (`feat(dash): …`), one concern per commit.
4. **Checks before you push:** `pnpm check-types`, `pnpm lint` (must stay at **zero findings** — Oxlint with the anti-slop plugin plus the brand and OSS-boundary checks), and `pnpm test` for the paths you touched. CI runs all three plus a secret scan and the release builds on every PR.
5. **Tests:** changes to behavior come with a test at the strongest boundary (a router test against the real database; PayPal faked at `fetch`). Money, permissions and state transitions always have coverage.
6. **Code rules:** [`CLAUDE.md`](CLAUDE.md) is binding for people too — zod at the boundary, integer minor units for money, no `console.log`, and no code path that moves money without a person's approval or an explicit rule.

## Pull requests

- Describe what changed, why, and how to check it (a walkthrough of the affected pages is worth more than a paragraph).
- Keep PRs reviewable: a series of honest commits beats one mixed one.
- Docs-only PRs are welcome; markdown is exempt from the brand check, but follow the [content rules](docs/environments.md) — describe what works, in test mode, without promising roadmap items.

## What we don't merge

- Features that bypass `perform`'s permission checks or the PayPal approval steps — the human-approves-payments rule is a product invariant, not a preference.
- The product name or domains hardcoded in source (`pnpm lint` fails by design; use `PLATFORM_NAME` and the domain variables).
- Vendor lock-in in a PR: infrastructure code belongs in `packages/infra` with Alchemy.
