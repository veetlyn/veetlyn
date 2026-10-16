# A1 Action Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every services action and read the demo and the later surfaces need gets one typed definition behind one `perform`, with actors, grants, `ActionError` and an action log, while the web behaves exactly as today.

**Architecture:** A registry in `packages/api/src/actions/` holds `defineAction` definitions (zod input and output, scope, grants, agent policy, `run`). `perform` parses the input, loads the scope (project and team, the actor's effective role), checks the grants, refuses agents, runs the use case, converts errors to `ActionError` and writes `action_log`. The services tRPC procedures become thin adapters that build the actor and call `perform`, converting `ActionError` back to the same `TRPCError` the web gets today. Router logic (`get`, `clientGet`, `list`, `requestQuote`, project visibility) moves into use cases.

**Tech Stack:** TypeScript (pnpm, turbo), tRPC 11, zod 4.5 (`z.toJSONSchema`), Drizzle on Postgres, Vitest with a real test database.

**Spec:** [`../2026-10-13-action-catalog-design.md`](../../../platform/2026-10-13-action-catalog-design.md) §4 (A1). Program: [`../2026-10-13-agentic-surfaces-program.md`](../../../platform/2026-10-13-agentic-surfaces-program.md) §4.

**Base:** main at `45988e4` (or later docs-only commits). Branch `a1-action-registry`, worktree `worktrees/a1-action-registry`, own test database `jendal_test_a1` (`docker exec jendal-pg createdb -U postgres jendal_test_a1`; copy `.env.test.local` into the worktree and point `TEST_DATABASE_URL` at it). Every worker uses only that database, never the dev database, and never pushes to main.

**Conventions:** Conventional Commits ending with `Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>` (Droid) or Claude Code's own attribution. Tests first at the owner boundary, following the test-audit gate (each test names a credible regression; no duplicate proof across layers). Checks per task: `npx vitest run <paths>`; before each commit `pnpm check-types` and `pnpm lint` (0 findings: decode at boundaries, no `typeof`, no `unknown` params except `cause`, `SAFETY:` on assertions, `fromPartial` for fakes). Never edit while Vitest runs. Comments only for non-obvious reasons; never mention runs, tasks or plans in code.

---

## Facts the tasks rely on (main at `45988e4`)

- **tRPC setup:** `packages/api/src/index.ts`: `publicProcedure`, `protectedProcedure` (UNAUTHORIZED "Authentication required" without a session). `servicesTeamProcedure` (`services-team-procedure.ts:9-17`) takes `{ teamSlug }`, resolves `findServicesTeamBySlug` and `servicesTeamRoleFor` (effective role), and throws NOT_FOUND "Team not found." for a missing team or no role; it adds `ctx.servicesTeam` (a `ServicesTeamRecord`) and `ctx.servicesTeamRole`. `requireAction` throws FORBIDDEN with a message.
- **Context:** `packages/api/src/context.ts:45-71`: `session`, `db`, `auth` (link secret via `linkSecret(ctx.auth)`, `client-links.ts:72`), `headers` (`cf-connecting-ip`), `paypal?`, `files`, `email?` (`EmailServices` with `mailer`, origins, `waitUntil?`, `onError?`), `now?`.
- **Project router:** `packages/api/src/routers/project.ts`:
  - `list` `:117-138`, `get` `:141-175` with the inline `requireVisibleProject` (`:80-99`, NOT_FOUND "Project not found."), `members` `:178`.
  - Team actions: `create` `:183-199`, `assign` `:201`, `addQuote` `:207`, `proposeAmendment` `:219`, `deliveryUploadStart` `:235`, `deliver` `:241`, `refundClient` `:254`, `deliveryFileUrl` `:258-263` (visibility, then the use case).
  - `requestQuote` `:268-321`: honeypot first, per-IP limit `quote-request:ip:{ip}` 20 per hour with TOO_MANY_REQUESTS "Too many requests. Wait a little and try again.", PRECONDITION_FAILED "Requests are not available right now." without email, the client email (failure: INTERNAL_SERVER_ERROR "We could not send the email. Try again in a moment.", after `onError`), the team notice through `waitUntil`.
  - `clientGet` `:324-401` and the client actions `:403-444`, with the token resolved by `projectIdFromToken` (`:67-71`, NOT_FOUND "This link is not valid.").
- **Use cases:** `packages/api/src/use-cases/projects.ts`:
  - `ProjectActor` `:62`; `fail(code, message)` `:65`; `runProjectTransaction` `:70` maps `ProjectConflictError` to CONFLICT "The project changed while you worked. Reload and try again.".
  - Permission refusals stay in the use cases: `:124` "Only admins and managers start projects.", `:182` "Only admins and managers assign freelancers.", `:318` amendments, `:519` and `:573` `SUBMIT_DELIVERY_REFUSAL`; `addQuote` checks the quoting mode.
  - Client use cases take `{ projectId, … }`: `acceptQuote` `:257`, `acceptAmendment` `:356`, `declineAmendment` `:458`, `requestChanges` `:630`, `acceptDelivery` `:655`. `deliveryFileUrl` `:603` expects callers to check access.
- **Other use cases:** `requestQuote(db, input)` (`use-cases/requests.ts:31`) validates, spends the per-email limit and creates the project. `refundClient({ db, paypal }, actor, { projectId })` (`client-refunds.ts:264`) throws `BAD_GATEWAY` on PayPal failures (`:256`).
- **Repositories:**
  - `findProjectById(tx, id)` (`packages/db/src/repositories/projects.ts:22`), `servicesTeamRoleFor(db, teamId, userId)` (`services-teams.ts:154`, null when no role), `getServicesTeamSettings` (`:51`).
  - `canSeeProject` lives in `@jendal-workspace/core`.
- **Unit of work:** `ProjectStateError` and `ProjectConflictError` are in `packages/db/src/repositories/unit-of-work.ts:10-21`.
- **Maintenance:** `runMaintenance` (`apps/server/src/maintenance.ts:58`) runs isolated sweeps through `sweep(name, run)`. `MaintenanceSweep` is the union at `:35`, and `MaintenanceReport` holds the counters.
- **Tests:** router tests call `appRouter.createCaller(ctx)` with `makeSession(userId)` (`routers/project.test.ts:50-75`). `truncateAll` is a hard-coded list (`packages/db/src/testing/db.ts:23`). The suite is 140 files and 1,571 tests at `083d553`; CI runs it on every push (`.github/workflows/ci.yml`).
- **Migrations:** `pnpm db:generate` (drizzle-kit) writes to `packages/db/src/migrations/`; the latest is `20261013100755_r5b1_payout_rules_since`.

## Decisions for this run

- **Grants stay coarse; permission checks stay in the use cases.** Team actions use `{ grant: "member" }` without a permission: the use cases keep today's permission checks and messages (`:124`, `:182`, …), so nothing the web shows changes. A later surface still goes through those checks because it calls the same use case.
- **The client grant is today's rule:** the holder of the project's client link. "A team member is never the client" lands in A2 with "Preview as client" (design §4.4, updated).
- **Outputs:** every action defines an `output` schema in wire format (dates as ISO strings). The queries `project.get` and `project.client_view` are web-only in A1 (`surfaces: ["web"]`, `output: null`); run C gives `project.client_view` its schema when the plugin needs it. The registry test enforces that a definition without an output is web-only.
- **Payout actions, payout events, `seller.get`, `earnings.get`** are not in A1 (design §2).

## File map

- Create `packages/api/src/actions/errors.ts` (+ `errors.test.ts`): `ActionError`, `toActionError(thrown)`, `toTRPCError(error)`.
- Create `packages/api/src/actions/actors.ts`: `Actor`, `Surface`, `RequestMeta`.
- Create `packages/api/src/actions/define.ts`: `ActionDefinition`, `Grant`, `AgentPolicy`, `defineAction`.
- Create `packages/api/src/actions/perform.ts` (+ `perform.test.ts`): `perform`, `ActionDeps`, scope loading, grants, the agent policy, the log write.
- Create `packages/api/src/actions/{requests,projects,quotes,deliveries}.ts`: the definitions. Create `packages/api/src/actions/registry.ts` (+ `registry.test.ts`): `ACTIONS`.
- Create `packages/api/src/actions/trpc.ts`: `teamProcedureFor`, `clientProcedureFor`, `publicProcedureFor`.
- Create `packages/api/src/use-cases/project-views.ts`: `listVisibleProjects`, `getTeamProjectView`, `getClientProjectView`, `teamDeliveryFileUrl`.
- Modify `packages/api/src/use-cases/requests.ts`: add `createQuoteRequest` (honeypot, per-IP limit, emails), keep `requestQuote`.
- Modify `packages/api/src/routers/project.ts`: every procedure becomes an adapter; the helpers move out.
- Create `packages/db/src/schema/action-log.ts` and export it from `packages/db/src/schema/index.ts`. Create `packages/db/src/repositories/action-log.ts` (`insertActionLog`, `deleteActionLogBefore`). Generate the migration. Add `action_log` to `truncateAll`.
- Modify `apps/server/src/maintenance.ts` (+ `maintenance.test.ts`): the `actionLog` sweep (180 days).

---

### Task 1: `ActionError`, actors and definitions

**Files:**
- Create: `packages/api/src/actions/errors.ts`, `packages/api/src/actions/actors.ts`, `packages/api/src/actions/define.ts`
- Test: `packages/api/src/actions/errors.test.ts`

- [ ] **Step 1: Write the failing test** (`errors.test.ts`, a table over the conversions)

```ts
import { ProjectConflictError, ProjectStateError } from "@jendal-workspace/db/repositories/unit-of-work";
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { ActionError, toActionError, toTRPCError } from "./errors";

describe("toActionError", () => {
  it.each([
    [new TRPCError({ code: "BAD_REQUEST", message: "Give the project a title." }), "invalid", "Give the project a title."],
    [new TRPCError({ code: "NOT_FOUND", message: "Project not found." }), "not_found", "Project not found."],
    [new TRPCError({ code: "FORBIDDEN", message: "Only admins and managers start projects." }), "forbidden", "Only admins and managers start projects."],
    [new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" }), "forbidden", "Authentication required"],
    [new TRPCError({ code: "CONFLICT", message: "The project changed while you worked. Reload and try again." }), "conflict", "The project changed while you worked. Reload and try again."],
    [new TRPCError({ code: "PRECONDITION_FAILED", message: "Requests are not available right now." }), "precondition_failed", "Requests are not available right now."],
    [new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests. Wait a little and try again." }), "rate_limited", "Too many requests. Wait a little and try again."],
    [new TRPCError({ code: "BAD_GATEWAY", message: "PayPal did not answer." }), "unavailable", "PayPal did not answer."],
    [new ProjectConflictError(), "conflict", "The project changed; refresh and try again."],
  ])("maps %s to %s", (thrown, code, message) => {
    const error = toActionError(thrown);
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
  });

  it("hides the message of an unexpected internal failure", () => {
    const error = toActionError(new ProjectStateError("The transaction applied no change to a project"));
    expect(error.code).toBe("internal");
    expect(error.message).toBe("Something went wrong. Try again in a moment.");
  });

  it("keeps a deliberate internal message", () => {
    const error = toActionError(new ActionError("internal", "We could not send the email. Try again in a moment.", { expose: true }));
    expect(error.message).toBe("We could not send the email. Try again in a moment.");
  });
});

describe("toTRPCError", () => {
  it("returns the tRPC code the use case threw", () => {
    const error = toTRPCError(toActionError(new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" })));
    expect(error.code).toBe("UNAUTHORIZED");
    expect(error.message).toBe("Authentication required");
  });

  it("maps codes that did not come from tRPC", () => {
    expect(toTRPCError(new ActionError("forbidden", "Agents cannot do this yet.")).code).toBe("FORBIDDEN");
    expect(toTRPCError(new ActionError("internal", "We could not send the email. Try again in a moment.", { expose: true })).code).toBe("INTERNAL_SERVER_ERROR");
  });
});
```

- [ ] **Step 2: Run it to see it fail:** `npx vitest run packages/api/src/actions/errors.test.ts`. Expected: it fails because `./errors` does not exist.

- [ ] **Step 3: Implement `errors.ts`**

```ts
import { ProjectConflictError } from "@jendal-workspace/db/repositories/unit-of-work";
import { TRPCError } from "@trpc/server";

export type ActionErrorCode =
  | "invalid"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "precondition_failed"
  | "rate_limited"
  | "unavailable"
  | "internal";

type TRPCCode = TRPCError["code"];

const GENERIC_INTERNAL = "Something went wrong. Try again in a moment.";

export class ActionError extends Error {
  readonly code: ActionErrorCode;
  readonly details?: Record<string, string[]>;
  readonly trpcCode?: TRPCCode;
  readonly expose: boolean;

  constructor(
    code: ActionErrorCode,
    message: string,
    options: { details?: Record<string, string[]>; trpcCode?: TRPCCode; expose?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ActionError";
    this.code = code;
    this.details = options.details;
    this.trpcCode = options.trpcCode;
    this.expose = options.expose ?? code !== "internal";
  }
}

const FROM_TRPC: Partial<Record<TRPCCode, ActionErrorCode>> = {
  BAD_REQUEST: "invalid",
  PARSE_ERROR: "invalid",
  NOT_FOUND: "not_found",
  FORBIDDEN: "forbidden",
  UNAUTHORIZED: "forbidden",
  CONFLICT: "conflict",
  PRECONDITION_FAILED: "precondition_failed",
  TOO_MANY_REQUESTS: "rate_limited",
  BAD_GATEWAY: "unavailable",
  SERVICE_UNAVAILABLE: "unavailable",
  GATEWAY_TIMEOUT: "unavailable",
};

const TO_TRPC: Record<ActionErrorCode, TRPCCode> = {
  invalid: "BAD_REQUEST",
  not_found: "NOT_FOUND",
  forbidden: "FORBIDDEN",
  conflict: "CONFLICT",
  precondition_failed: "PRECONDITION_FAILED",
  rate_limited: "TOO_MANY_REQUESTS",
  unavailable: "BAD_GATEWAY",
  internal: "INTERNAL_SERVER_ERROR",
};

export function toActionError(thrown: unknown): ActionError {
  if (thrown instanceof ActionError) {
    return thrown.expose ? thrown : new ActionError("internal", GENERIC_INTERNAL, { cause: thrown, trpcCode: thrown.trpcCode });
  }
  if (thrown instanceof TRPCError) {
    const code = FROM_TRPC[thrown.code] ?? "internal";
    const message = code === "internal" ? GENERIC_INTERNAL : thrown.message;
    return new ActionError(code, message, { trpcCode: thrown.code, cause: thrown, expose: code !== "internal" });
  }
  if (thrown instanceof ProjectConflictError) return new ActionError("conflict", thrown.message, { cause: thrown });
  return new ActionError("internal", GENERIC_INTERNAL, { cause: thrown });
}

export function toTRPCError(error: ActionError): TRPCError {
  return new TRPCError({ code: error.trpcCode ?? TO_TRPC[error.code], message: error.message, cause: error });
}
```

  `toActionError` takes the thrown value because a `catch` binding has no type; the parameter is named `thrown`, and the lint rule allows `unknown` only for `cause`. If the rule flags it, name the parameter `cause`.

- [ ] **Step 4: Implement `actors.ts` and `define.ts`**

```ts
// actors.ts
export type Surface = "web" | "api" | "mcp" | "discord" | "slack" | "cron" | "webhook";

export type ClientLinkToken = { projectId: string };

export type Actor =
  | { kind: "user"; userId: string }
  | { kind: "client_link"; token: ClientLinkToken }
  | { kind: "anonymous" }
  | { kind: "system"; job: string }
  // Defined now so policies can be tested; perform refuses it until proposals exist.
  | { kind: "agent"; agentId: string; onBehalfOf: Actor };

export type RequestMeta = { requestId: string; ip: string | null };
```

```ts
// define.ts
import type { ServicesTeamAction } from "@jendal-workspace/core";
import type { z } from "zod";

import type { Actor, RequestMeta, Surface } from "./actors";
import type { ActionDeps, Scope } from "./perform";

export type Grant =
  | { grant: "member"; permission?: ServicesTeamAction; message?: string }
  | { grant: "client" }
  | { grant: "signed_in" }
  | { grant: "anyone" }
  | { grant: "system" };

export type AgentPolicy = "free" | "confirm" | "never";

export type ScopeRequest = { projectId?: string; teamId?: string };

export type ActionDefinition<Input, Result> = {
  name: string;
  kind: "action" | "query";
  summary: string;
  input: z.ZodType<Input>;
  // Wire format (dates as ISO strings); null only for web-only queries.
  output: z.ZodType | null;
  surfaces?: readonly Surface[];
  scope: (input: Input) => ScopeRequest;
  allow: readonly Grant[];
  agent?: AgentPolicy;
  run: (
    context: { deps: ActionDeps; actor: Actor; scope: Scope; surface: Surface; request: RequestMeta },
    input: Input,
  ) => Promise<Result>;
};

export function defineAction<Input, Result>(definition: ActionDefinition<Input, Result>): ActionDefinition<Input, Result> {
  return definition;
}

export function agentPolicyOf(definition: Pick<ActionDefinition<never, never>, "kind" | "agent">): AgentPolicy {
  return definition.agent ?? (definition.kind === "query" ? "free" : "confirm");
}
```

- [ ] **Step 5: Run the test:** `npx vitest run packages/api/src/actions/errors.test.ts`. Expected: it passes. `define.ts` refers to `./perform` types, so write a stub `perform.ts` that exports `ActionDeps` and `Scope` as specified in Task 3, Step 3 (types only) to keep `pnpm check-types` green.

- [ ] **Step 6: Commit** `feat(api): action errors, actors and definitions`.

---

### Task 2: `action_log` table, repository and cleanup

**Files:**
- Create: `packages/db/src/schema/action-log.ts`, `packages/db/src/repositories/action-log.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/testing/db.ts:23`, `apps/server/src/maintenance.ts`
- Test: `apps/server/src/maintenance.test.ts` (extend)

- [ ] **Step 1: Schema**

```ts
// packages/db/src/schema/action-log.ts
import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Who did what, for whom and from where. Inputs are never stored: they can hold client personal data.
export const actionLog = pgTable(
  "action_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    requestId: text("request_id").notNull(),
    action: text("action").notNull(),
    surface: text("surface").notNull(),
    teamId: text("team_id"),
    projectId: text("project_id"),
    subjectKind: text("subject_kind"),
    subjectId: text("subject_id"),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id"),
    onBehalfOf: jsonb("on_behalf_of"),
    ip: text("ip"),
    outcome: text("outcome").notNull(),
    message: text("message"),
    durationMs: integer("duration_ms").notNull(),
  },
  (t) => [index("action_log_created_at_idx").on(t.createdAt), index("action_log_team_created_idx").on(t.teamId, t.createdAt)],
);
```

  No foreign keys: the log outlives deleted rows and never blocks a delete. Export it from `schema/index.ts` next to `outbox`.

- [ ] **Step 2: Repository**

```ts
// packages/db/src/repositories/action-log.ts
import { lt } from "drizzle-orm";

import type { Database } from "../index";
import { actionLog } from "../schema/action-log";

export type ActionLogRow = typeof actionLog.$inferInsert;

export async function insertActionLog(db: Database, row: ActionLogRow): Promise<void> {
  await db.insert(actionLog).values(row);
}

export async function deleteActionLogBefore(db: Database, before: Date): Promise<number> {
  const rows = await db.delete(actionLog).where(lt(actionLog.createdAt, before)).returning({ id: actionLog.id });
  return rows.length;
}
```

- [ ] **Step 3: Migration:** `pnpm db:generate` (writes `packages/db/src/migrations/<timestamp>_<name>/`). Rename the folder suffix to `a1_action_log` if drizzle-kit picked a random name, and check that the SQL creates only `action_log` and its two indexes. Add `"action_log"` to the `truncate table` list in `packages/db/src/testing/db.ts:23`.

- [ ] **Step 4: Write the failing maintenance test:** in `apps/server/src/maintenance.test.ts`, add a case next to the request-limit sweep. Insert two log rows, created 181 and 179 days before the fixed `now`. After `runMaintenance`, only the 179-day row remains, and `report.actionLogDeleted === 1`.

- [ ] **Step 5: Run it:** `npx vitest run apps/server/src/maintenance.test.ts`. Expected: the new case fails.

- [ ] **Step 6: Implement the sweep:** add `"actionLog"` to `MaintenanceSweep`, `actionLogDeleted: 0` to the report, `const ACTION_LOG_RETENTION_MS = 180 * 86_400_000;` with the comment "PayPal's dispute window is 180 days", and:

```ts
await sweep("actionLog", async () => {
  report.actionLogDeleted = await deleteActionLogBefore(deps.db, new Date(now - ACTION_LOG_RETENTION_MS));
  return { deleted: report.actionLogDeleted };
});
```

- [ ] **Step 7: Run the test:** `npx vitest run apps/server/src/maintenance.test.ts`. Expected: it passes. Then `pnpm check-types` and `pnpm lint`.

- [ ] **Step 8: Commit** `feat(db): action log with a 180-day cleanup`.

---

### Task 3: `perform`

**Files:**
- Create: `packages/api/src/actions/perform.ts`
- Test: `packages/api/src/actions/perform.test.ts`

- [ ] **Step 1: Write the failing tests** (real test database; definitions declared inside the test file, so nothing depends on Task 5)

Seed with `seedServicesTeamWithAdmin`, `seedServicesTeamMember` (freelancer) and `seedProject`. Declare a small set of test definitions:
- `test.team_query`: `{ grant: "member" }`, project scope.
- `test.client_action`: `{ grant: "client" }`.
- `test.public_action`: `{ grant: "anyone" }`.
- `test.throws`: `run` throws `new TRPCError({ code: "BAD_GATEWAY", message: "PayPal did not answer." })`.

Cases, one `it` each:
1. A team member gets the result. Each action writes one `action_log` row with `outcome: "ok"`, the actor and the project.
2. A signed-in user with no role in the team gets `not_found` "Project not found.".
3. An adapter-passed team that differs from the project's team gets `not_found`.
4. A `client_link` actor for the project passes `{ grant: "client" }`. The same token for another project gets `not_found`.
5. An `anonymous` actor passes `{ grant: "anyone" }` and fails `{ grant: "member" }` with `forbidden`.
6. An `agent` actor is refused with `forbidden`, "Agents cannot do this yet.", whatever the grant.
7. `test.throws` rejects with `ActionError` `unavailable` and logs `outcome: "unavailable"` with the message.
8. Queries from surface `web` write no log row; the same query from surface `api` writes one.
9. An input that fails zod gets `invalid` with `details` listing the field.
10. A failed log write (call `perform` with a `deps.db` whose `insert` throws for `action_log`, built with `fromPartial` around the real db) still returns the result.

- [ ] **Step 2: Run them:** `npx vitest run packages/api/src/actions/perform.test.ts`. Expected: they fail.

- [ ] **Step 3: Implement `perform.ts`**

```ts
import type { FileStore, ServicesTeamRole } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import { insertActionLog } from "@jendal-workspace/db/repositories/action-log";
import { findProjectById, type ProjectRow } from "@jendal-workspace/db/repositories/projects";
import { servicesTeamRoleFor } from "@jendal-workspace/db/repositories/services-teams";

import type { EmailServices, PayPalServices } from "../context";
import type { LinkSecretSource } from "../client-links";
import type { Actor, RequestMeta, Surface } from "./actors";
import type { ActionDefinition, Grant } from "./define";
import { ActionError, toActionError } from "./errors";

export type ActionDeps = {
  db: Database;
  files: FileStore;
  auth: LinkSecretSource;
  paypal?: PayPalServices;
  email?: EmailServices;
  now?: () => Date;
  onLogError?: (cause: unknown) => void;
};

export type Scope = { teamId: string | null; project: ProjectRow | null; role: ServicesTeamRole | null };

export type PerformRequest = {
  deps: ActionDeps;
  actor: Actor;
  surface: Surface;
  request: RequestMeta;
  // Resolved by an adapter from a team slug; must match the project's team.
  team?: { id: string };
};

const NOT_FOUND_PROJECT = "Project not found.";

async function loadScope(req: PerformRequest, scopeRequest: { projectId?: string; teamId?: string }): Promise<Scope> {
  let project: ProjectRow | null = null;
  let teamId = scopeRequest.teamId ?? req.team?.id ?? null;
  if (scopeRequest.projectId) {
    project = await findProjectById(req.deps.db, scopeRequest.projectId);
    if (!project || (teamId && project.teamId !== teamId)) throw new ActionError("not_found", NOT_FOUND_PROJECT);
    teamId = project.teamId;
  }
  const role =
    teamId && req.actor.kind === "user" ? await servicesTeamRoleFor(req.deps.db, teamId, req.actor.userId) : null;
  return { teamId, project, role };
}

function passes(grant: Grant, actor: Actor, scope: Scope): boolean {
  switch (grant.grant) {
    case "member":
      return scope.role !== null;
    case "client":
      return actor.kind === "client_link" && scope.project !== null && actor.token.projectId === scope.project.id;
    case "signed_in":
      return actor.kind === "user";
    case "anyone":
      return true;
    case "system":
      return actor.kind === "system";
  }
}

// Someone with no relation to the team or project learns nothing about it.
function refusal(actor: Actor, scope: Scope): ActionError {
  const related = scope.role !== null || actor.kind === "client_link";
  if (!related && scope.project) return new ActionError("not_found", NOT_FOUND_PROJECT);
  if (!related && scope.teamId) return new ActionError("not_found", "Team not found.");
  return new ActionError("forbidden", "You cannot do this.");
}

export async function perform<Input, Result>(
  req: PerformRequest,
  definition: ActionDefinition<Input, Result>,
  rawInput: unknown,
): Promise<Result> {
  const started = Date.now();
  let scope: Scope = { teamId: req.team?.id ?? null, project: null, role: null };
  try {
    // Agents only propose once proposals exist; until then they are refused whatever the policy.
    if (req.actor.kind === "agent") throw new ActionError("forbidden", "Agents cannot do this yet.");
    const parsed = definition.input.safeParse(rawInput);
    if (!parsed.success) {
      const details: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "input";
        (details[key] ??= []).push(issue.message);
      }
      throw new ActionError("invalid", "Check the highlighted fields.", { details, trpcCode: "BAD_REQUEST" });
    }
    scope = await loadScope(req, definition.scope(parsed.data));
    if (!definition.allow.some((grant) => passes(grant, req.actor, scope))) throw refusal(req.actor, scope);
    const result = await definition.run(
      { deps: req.deps, actor: req.actor, scope, surface: req.surface, request: req.request },
      parsed.data,
    );
    await writeLog(req, definition, scope, "ok", null, started);
    return result;
  } catch (thrown) {
    const error = toActionError(thrown);
    await writeLog(req, definition, scope, error.code, error.message, started);
    throw error;
  }
}
```

  The `never` policy needs no runtime branch until run D, because every agent is refused. `writeLog` skips queries from `web` and records:
  - the actor kind;
  - the actor ID: the `userId` for users, null for client links in A1;
  - `on_behalf_of`;
  - the team, project, outcome, message and duration.

  It uses `insertActionLog` inside `try`/`catch` and calls `deps.onLogError` on failure. It never throws.

- [ ] **Step 4: Run the tests:** `npx vitest run packages/api/src/actions/perform.test.ts`. Expected: they pass.

- [ ] **Step 5: Commit** `feat(api): perform loads the scope, checks grants and logs every action`.

---

### Task 4: Router logic moves into use cases

**Files:**
- Create: `packages/api/src/use-cases/project-views.ts`
- Modify: `packages/api/src/use-cases/requests.ts`
- Test: the existing `packages/api/src/routers/project.test.ts` (no new tests; this task moves code)

- [ ] **Step 1: Move the views:** create `project-views.ts` with:
  - `listVisibleProjects(db, { teamId, role, actorId })`: the body of `list` (`routers/project.ts:117-138`).
  - `getTeamProjectView({ db, auth }, { teamId, role, actorId, solo }, projectId)`: the body of `get` (`:141-175`), with `requireVisibleProject` (`:80-99`) and `withDeliveryFiles` (`:102-110`) moved in. It still returns `clientPath`; A2 removes it.
  - `getClientProjectView({ db, auth }, projectId)`: the body of `clientGet` (`:324-401`).
  - `teamDeliveryFileUrl({ db, files }, viewer, { projectId, deliveryId })`: the visibility check followed by `deliveryFileUrl`.

  Each keeps the same messages and return shapes.

- [ ] **Step 2: Move the request form:** add `createQuoteRequest({ db, auth, email }, { ip }, input)` to `use-cases/requests.ts`. It holds the body of the `requestQuote` procedure (`:268-321`): honeypot first, then the per-IP limit when an IP is known, then the PRECONDITION_FAILED answer without email, then `requestQuote`, the client email and the team notice. The failed client email throws `new ActionError("internal", "We could not send the email. Try again in a moment.", { expose: true, trpcCode: "INTERNAL_SERVER_ERROR" })` after `onError`.

- [ ] **Step 3: Point the router at the new use cases** (the procedures keep their names and inputs), then run `npx vitest run packages/api/src/routers/project.test.ts`. Expected: every test passes unchanged.

- [ ] **Step 4: Commit** `refactor(api): project views and the request form move into use cases`.

---

### Task 5: Definitions and the registry

**Files:**
- Create: `packages/api/src/actions/{requests,projects,quotes,deliveries,registry}.ts`
- Test: `packages/api/src/actions/registry.test.ts`

- [ ] **Step 1: Write the failing registry test**

```ts
import { z } from "zod";
import { describe, expect, it } from "vitest";

import { agentPolicyOf } from "./define";
import { ACTIONS } from "./registry";

describe("action registry", () => {
  it("has unique names, a summary and a policy for every action", () => {
    const names = ACTIONS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    for (const action of ACTIONS) expect(action.summary.length).toBeGreaterThan(20);
  });

  it("exports every input and output as JSON Schema", () => {
    for (const action of ACTIONS) {
      expect(() => z.toJSONSchema(action.input)).not.toThrow();
      if (action.output) expect(() => z.toJSONSchema(action.output!)).not.toThrow();
    }
  });

  it("keeps definitions without an output on the web only", () => {
    for (const action of ACTIONS.filter((a) => a.output === null)) expect(action.surfaces).toEqual(["web"]);
  });

  it("never lets an agent commit the client or move money on its own", () => {
    const committing = ["quote.accept", "amendment.accept", "delivery.accept", "project.refund_client", "quote.create", "delivery.submit"];
    for (const name of committing) {
      const action = ACTIONS.find((a) => a.name === name);
      expect(action, name).toBeDefined();
      expect(agentPolicyOf(action!)).not.toBe("free");
    }
    expect(agentPolicyOf(ACTIONS.find((a) => a.name === "project.refund_client")!)).toBe("never");
  });
});
```

- [ ] **Step 2: Run it:** `npx vitest run packages/api/src/actions/registry.test.ts`. Expected: it fails because the registry does not exist.

- [ ] **Step 3: Write the definitions.** The inputs are the router's current zod schemas without `teamSlug` and `token` (abuse caps, as today). Every `run` calls the existing use case:

| Name | File | Kind | Scope | Allow | Agent | Run |
|---|---|---|---|---|---|---|
| `request.create` | requests | action | none | anyone | confirm | `createQuoteRequest(deps, { ip: request.ip }, input)` |
| `project.start` | projects | action | `teamId` (adapter) | member | confirm | `startProject` |
| `project.assign` | projects | action | project | member | confirm | `assignFreelancer` |
| `project.refund_client` | projects | action | project | member | never | `refundClient` (needs `deps.paypal`) |
| `project.list` | projects | query | `teamId` | member | free | `listVisibleProjects` |
| `project.get` | projects | query | project | member | free | `getTeamProjectView` (web only, output null) |
| `project.client_view` | projects | query | project | client | free | `getClientProjectView` (web only, output null) |
| `quote.create` | quotes | action | project | member | confirm | `addQuote` |
| `quote.accept` | quotes | action | project | client | confirm | `acceptQuote` |
| `amendment.propose` | quotes | action | project | member | confirm | `proposeAmendment` |
| `amendment.accept` | quotes | action | project | client | confirm | `acceptAmendment` |
| `amendment.decline` | quotes | action | project | client | confirm | `declineAmendment` |
| `delivery.upload_start` | deliveries | action | project | member | confirm | `startDeliveryUpload` |
| `delivery.submit` | deliveries | action | project | member | confirm | `submitDelivery` |
| `delivery.request_changes` | deliveries | action | project | client | confirm | `requestChanges` |
| `delivery.accept` | deliveries | action | project | client | confirm | `acceptDelivery` |
| `delivery.file_url` | deliveries | query | project | member or client | free | member: `teamDeliveryFileUrl`; client: `deliveryFileUrl` |

  Notes:
  - Team actions build the `ProjectActor` from the scope: `{ teamId: scope.teamId, role: scope.role, actorId: actor.userId }`.
  - Summaries are one plain sentence that names the limits. Example for `quote.create`: "Send the client a quote: 1 to 20 items with amounts in minor units and the delivery days (1 to 365)."
  - Outputs mirror what each use case returns, in wire format. For example, `quote.accept` returns `{ paymentId, payPath }`; check the exact shape in `use-cases/projects.ts:257-308`. An action that returns nothing outputs `z.null()`.
  - `registry.ts` exports `ACTIONS` as an array in the order of the table.

- [ ] **Step 4: Run the test:** `npx vitest run packages/api/src/actions/registry.test.ts`. Expected: it passes. Add one case that serializes a fixture result of `quote.accept` through `JSON.parse(JSON.stringify(...))` and parses it with the output schema.

- [ ] **Step 5: Commit** `feat(api): the services actions in the registry`.

---

### Task 6: tRPC adapters and the project router on `perform`

**Files:**
- Create: `packages/api/src/actions/trpc.ts`
- Modify: `packages/api/src/routers/project.ts`
- Test: `packages/api/src/routers/project.test.ts` (unchanged expectations), plus one log test

- [ ] **Step 1: Adapters**

```ts
// trpc.ts: builds the actor and the deps from the tRPC context and converts errors back.
import { z } from "zod";

import type { Context } from "../context";
import { publicProcedure } from "../index";
import { linkSecret, verifyClientLink } from "../client-links";
import { servicesTeamProcedure } from "../services-team-procedure";
import type { Actor } from "./actors";
import type { ActionDefinition } from "./define";
import { ActionError, toTRPCError } from "./errors";
import { perform, type ActionDeps } from "./perform";

function depsOf(ctx: Context): ActionDeps {
  return { db: ctx.db, files: ctx.files, auth: ctx.auth, paypal: ctx.paypal, email: ctx.email, now: ctx.now };
}

function requestOf(ctx: Context) {
  return { requestId: crypto.randomUUID(), ip: ctx.headers.get("cf-connecting-ip")?.trim() || null };
}

async function run<I, R>(ctx: Context, actor: Actor, definition: ActionDefinition<I, R>, input: unknown, team?: { id: string }) {
  try {
    return await perform({ deps: depsOf(ctx), actor, surface: "web", request: requestOf(ctx), team }, definition, input);
  } catch (error) {
    throw error instanceof ActionError ? toTRPCError(error) : error;
  }
}
```

  Export three builders, each returning a procedure with the right input wrapper:
  - `teamProcedure(definition, inputSchema)`: `servicesTeamProcedure.input(inputSchema)`, actor `{ kind: "user", userId: ctx.session.user.id }`, team `ctx.servicesTeam`.
  - `clientProcedure(definition, inputSchema)`: `publicProcedure.input(inputSchema.extend({ token }))`. It verifies the token with `verifyClientLink(linkSecret(ctx.auth), token)`, throws NOT_FOUND "This link is not valid." on failure, and uses actor `{ kind: "client_link", token: { projectId } }`. The `projectId` is added to the input passed to `perform`.
  - `publicAction(definition, inputSchema)`: actor `{ kind: "anonymous" }`.

  Use `.query` or `.mutation` according to `definition.kind`.

- [ ] **Step 2: Rewrite `routers/project.ts`:** every procedure becomes a one-liner through the builders, keeping its current name, input schema and return value. Two exceptions:
  - `create` keeps signing `clientPath` after `perform` returns `{ projectId }`.
  - `members` stays as it is; it is a list of team members, not a project action.

  The helpers moved in Task 4 are deleted from the router.

- [ ] **Step 3: Run the full router suite:** `npx vitest run packages/api/src/routers/project.test.ts`. Expected: all tests pass with no expectation changes. If one must change, stop and record why in this plan's Outcome before changing it.

- [ ] **Step 4: Add one test** to `project.test.ts`: after `clientAcceptQuote`, `action_log` holds one row with `action: "quote.accept"`, `surface: "web"`, `actor_kind: "client_link"` and `outcome: "ok"`; `project.get` wrote none.

- [ ] **Step 5: Full checks:** `pnpm check-types`, `pnpm lint`, `pnpm test`. Expected: green, 1,571 tests plus the new ones.

- [ ] **Step 6: Commit** `refactor(api): project procedures call perform`.

---

### Task 7: Review, merge, walkthrough (controller)

- [ ] Whole-branch review (explorer, heavy) against the design §4 and this plan: behavior unchanged, messages unchanged, every definition's grant correct, no adapter bypass, log contents free of personal data.
- [ ] Open a pull request from `a1-action-registry`; CI green. Merge with `--no-ff` into main, run `pnpm install` and `pnpm db:migrate:dev`, check that `action_log` exists in the dev database, and restart the stack.
- [ ] Walkthrough over the tunnel, with the stories run unchanged as the regression proof:
  - QUO-02, QUO-03: request a quote and get the client link
  - QUO-10, QUO-11: start a project and quote it
  - QUO-13: accept the quote
  - PAY-01, PAY-02: pay the deposit, with [human] Mouhamed in the PayPal popup
  - DEL-01, DEL-05: deliver, then request changes
  - DEL-07, DEL-08: accept the delivery and pay the balance [human]

  After each action, check `select action, surface, actor_kind, outcome from action_log order by created_at desc limit 20` in the dev database.
- [ ] Record: this plan's Outcome, the design status (A1 built), the stories' statuses (`Verified <date> on tunnel at <commit>`), PROGRESS (board, Now, decisions) and BACKLOG; remove the worktree, the branch and `jendal_test_a1`.

## Outcome

Merged 2026-10-14 12:06 UTC as PR #1, merge commit `4a27fb6`.

- **Review:** two-stage review on the PR; the fixes it produced are the branch's tail commits — `3237f65` (original error kept for the tRPC error log), `b2189d4` (action-log failures reported, unchecked grant fields dropped), `5bed46c` (registry tests export inputs in input mode, dates round-trip), `4541f75` (PayPal's refusal text stays out of the action log), `e4d5dd7` (test-audit and anti-slop pass), `99cc6d6` (export clock fix).
- **Walkthrough:** the plan's "stories run unchanged" walkthrough ran as the spike S walkthrough on branch `spike-plugin`, whose merge base with main is exactly `4a27fb6`. The full hire flow A1–A19 passed over the tunnel in Claude (2026-10-14) and in ChatGPT (2026-10-15): the client side through the plugin, the seller side (assign, quote, deliveries) in the admin at `admin.payleor.com`, so both the client actions and the web adapters on `perform` were exercised. Results: [`2026-10-14-s-plugin-walkthrough.md`](2026-10-14-s-plugin-walkthrough.md). Story files were not individually re-marked; the walkthrough's results table carries the dated evidence.
- **Cleanup:** the local branch, worktree and `jendal_test_a1` database are gone; the merged remote branch `origin/a1-action-registry` was deleted on 2026-10-16.
