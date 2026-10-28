# @opmodel/engine-scheduler

Pure schedule reconciliation for timed rules. Given a subject's state (a project's status, its timestamps and its pinned `RulebookRules` from `@opmodel/engine-rules`), `planProjectSchedule` returns exactly which schedule items to arm and which to cancel. No clock, no store, no I/O — adapters do the persisting.

## Install

```bash
npm install @opmodel/engine-scheduler @opmodel/engine-rules
```

## Quickstart

```typescript
import { AGENCY_RULEBOOK_SPEC } from "@opmodel/engine-rules";
import { planProjectSchedule } from "@opmodel/engine-scheduler";

const plan = planProjectSchedule({
  projectStatus: "quoting",
  requestedAt: new Date("2026-10-01T00:00:00Z"),
  workStartedAt: null,
  lastMemberActivityAt: null, // the seller's reply, once it happens
  deliveredAt: null,
  pausedByDispute: false,
  rules: AGENCY_RULEBOOK_SPEC.rules,
});
// plan.schedule: request.remind at +36h, request.expire at +48h
// plan.cancel: [] — and once the seller replies, both kinds move to cancel
```

## Semantics

- Kinds: `request.remind`, `request.expire`, `member.updateRemind`, `member.updateLate`, `client.reviewRemind1`, `client.reviewRemind2`, `project.autoComplete`, `project.abandon`.
- `cancel` names the kinds armed by the phase just left, so a store reconciles idempotently on every transition.
- Terminal statuses cancel everything; `pausedByDispute` holds due items (`paused: true`) until the dispute resolves.
