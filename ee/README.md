# Enterprise features

Code in this folder is licensed under the [Veetlyn Enterprise License](LICENSE), not the AGPL. Running it in production needs a commercial agreement; developing and testing it does not.

It holds the features sold on top of the AGPL core:

| Feature | Status |
|---|---|
| Custom offers: sales requests, defining a custom plan and applying it to an account | Planned |
| Network membership: review, the member check and AI visibility | Planned |
| Payout agent: agent-prepared payouts and the second approver for large payouts | Planned |
| Multi-account: several agencies, shops and studios under one account | Planned |

## Boundary

- Code here may import the AGPL core (`apps/`, `packages/`).
- Code outside `ee/` must never import from `ee/`. The core works without this folder; `pnpm lint` checks it (`scripts/check-ee-boundary.mjs`).
- `packages/oss/` stays MIT and imports neither.
