# Run 3c: Quote request form, emails and limits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client on a published seller page (`{slug}.{storeDomain}`) fills a "Request a quote" form; Payleor creates the project in `quoting` (`source = "web"`), emails the client their private `/c/{token}` page and notifies the team, with spam limits and a honeypot.

**Architecture:** A public tRPC mutation `project.requestQuote` (the web worker already forwards `/trpc/*` from any host to the api Worker, so no infra change). A new use case inserts the project and writes the `project.created` outbox event; the router enforces the limits (`request_limit` table) and sends the emails through a new optional `email` port on the api context (same shape as `onTeamStatusChanged`). The form is a client component on a new store-host page `/request`; the seller page's mailto links become links to it.

**Tech Stack:** Cloudflare Workers (Hono api + vinext web), tRPC, Drizzle/Postgres, packages/email (Resend transport), vitest.

**Design:** [`../2026-10-07-sellers-minimal-flow-design.md`](../2026-10-07-sellers-minimal-flow-design.md): §3.3 (seller page), §4.2 (requesting a quote), §11 run 3.

---

## Facts an implementer must know

- Work in the worktree `/home/mouhamed/dev/repos/jendal/worktrees/r3c-request-form` (branch `r3c-request-form`, forked from `main` at `29b6188`). Commands run there. Tests need Postgres via `.env.test.local` (already copied into the worktree; `docker ps` shows `jendal-pg` for dev, the test database is separate and already configured).
- Run tests with `pnpm test <paths>` (e.g. `pnpm test packages/api/src/routers/project.test.ts`), types with `pnpm check-types`, web types with `pnpm -F web check-types`.
- Commits: conventional subject, trailer `Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>`.
- A "request" is a `project` row with `source = "web"`; there is no separate request table. New projects default to status `quoting`.
- The client page already exists at `/c/{token}` (apps/web route group `(site)`), and `signClientLink(linkSecret(ctx.auth), projectId)` signs tokens (`packages/api/src/client-links.ts`). Tokens never expire.
- `packages/api/src/use-cases/projects.ts` has a private `fail(code, message)` helper and `runProjectTransaction(db, fn)` (also private); the new use case file gets its own copies or imports what is exported. Its messages are full sentences shown to the caller.
- `hitRequestLimit(db, { key, windowMs, max })` (`packages/db/src/repositories/request-limits.ts`) atomically counts hits in a fixed window and returns whether the hit is allowed. Old rows are swept daily by the maintenance cron.
- The mailer interface (`packages/email/src/mailer.ts`): `send({ sender, onBehalfOf?, replyTo?, tag?, to, subject, text, html })`. `createFakeMailer()` (`packages/email/src/fake.ts`) records `sent` for tests. Sender keys and `onBehalfOf` ("{Team} via Payleor") are in `packages/email/src/senders.ts`.
- The api `Context` (`packages/api/src/context.ts`) carries optional ports (`paypal?`, `onTeamStatusChanged?`) that tests omit and the server wires in `apps/server/src/context.ts` from `apps/server/src/services.ts`.
- `findServicesTeamBySlug(db, slug)` (`packages/db/src/repositories/services-teams.ts`) returns `{ id, organizationId, slug, name, status, paypalMerchantId }` for services teams only (null for stores). `getServicesTeamSettings(db, teamId)` returns `{ currency, managementFeeBps, teamCutBps, solo, ... }`. `findServicesOffering(db, { id, teamId })` (`packages/db/src/repositories/services-catalog.ts`) returns the offering with `active`.
- `isStorePublic({ status })` (`packages/core/src/tenancy/store.ts`) is true only for `active`.
- `team.supportEmail` is a nullable text column on the `team` table.
- The client IP comes from the `cf-connecting-ip` header (precedent: `packages/auth/src/index.ts` sets `advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip"]`). Locally there is no such header; skip the IP limit then.
- The intake questions of an offering are already public (`/api/store/page` includes them); the answers are stored on the project.
- Server-side email needs absolute URLs. `ENV.BETTER_AUTH_URL` is the admin origin (`http://admin.localhost:3001` dev, `https://admin.payleor.com` prod); the site origin is the same without the `admin.` subdomain.
- Out of scope: the intake agent drafting a quote (run 6), outbox→email notifications (Notifications run), Turnstile (run 7).

## Decisions (controller, within the design)

- **Limit numbers** (the design names the kinds, not the numbers): per IP 20 requests/hour; per email per team 5 requests/hour; 3 open requests (`quoting`…`awaiting_balance`) per email per team. Constants live in core so the admin copy can quote them later.
- **Honeypot**: a hidden `website` field; a filled field returns success without creating anything (bots see no difference).
- **Title** of a web request: the offering's name, or "Something else".
- **Client email is awaited** (if it fails, the mutation errors and the client can retry; the project row stays, which is acceptable — the team still sees it). **The team notification is best-effort** in `waitUntil`.
- The form lives on its own page `/request` (relative links from the seller page; the admin preview passes the public origin so its links work too).

---

### Task 0: Worktree (controller)

- [ ] `git -C /home/mouhamed/dev/repos/jendal/worktrees/main worktree add ../r3c-request-form -b r3c-request-form`
- [ ] Copy `.env.test.local` files from main (same paths as in the r3b worktree), `pnpm install`, baseline `pnpm check-types`.

---

### Task 1: core — request validation and the open-status list

**Files:**
- Create: `packages/core/src/sellers/quote-request.ts`
- Test: `packages/core/src/sellers/quote-request.test.ts`
- Modify: `packages/core/src/projects/state-machine.ts` (export the open list), `packages/core/src/index.ts` (export the new module)

- [ ] **Step 1: Write the failing test.** `validateQuoteRequest` returns a list of problems (empty when valid). Cover: blank name → "Tell us your name."; name of 81 chars → "Keep your name under 80 characters."; bad email → "That email address does not look right."; description under 10 chars → "Describe what you need in at least a sentence."; description over 2000 chars → "Keep the description under 2,000 characters."; 6 answers → "Answer up to 5 questions."; an empty answer → "Answer every question or remove it."; a valid draft (name, email, 20-char description, two answers) → `[]`. Also `OPEN_PROJECT_STATUSES` equals `["quoting", "awaiting_deposit", "in_progress", "delivered", "awaiting_balance"]`.

- [ ] **Step 2: Run** `pnpm test packages/core/src/sellers/quote-request.test.ts` → FAIL (module does not exist).

- [ ] **Step 3: Implement.**

`packages/core/src/sellers/quote-request.ts`:

```ts
// Sellers design §4.2: the quote request form on the seller page.
export type QuoteRequestAnswer = { question: string; answer: string };

export type QuoteRequestDraft = {
  name: string;
  email: string;
  description: string;
  answers: QuoteRequestAnswer[];
};

export const QUOTE_REQUEST_LIMITS = {
  maxName: 80,
  maxEmail: 320,
  minDescription: 10,
  maxDescription: 2000,
  maxAnswers: 5,
  maxAnswer: 1000,
  openPerEmailPerTeam: 3,
} as const;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validateQuoteRequest(draft: QuoteRequestDraft): string[] {
  const problems: string[] = [];
  const name = draft.name.trim();
  if (name.length === 0) problems.push("Tell us your name.");
  else if (name.length > QUOTE_REQUEST_LIMITS.maxName) {
    problems.push(`Keep your name under ${QUOTE_REQUEST_LIMITS.maxName} characters.`);
  }
  const email = draft.email.trim();
  if (!EMAIL_PATTERN.test(email) || email.length > QUOTE_REQUEST_LIMITS.maxEmail) {
    problems.push("That email address does not look right.");
  }
  const description = draft.description.trim();
  if (description.length < QUOTE_REQUEST_LIMITS.minDescription) {
    problems.push("Describe what you need in at least a sentence.");
  } else if (description.length > QUOTE_REQUEST_LIMITS.maxDescription) {
    problems.push("Keep the description under 2,000 characters.");
  }
  if (draft.answers.length > QUOTE_REQUEST_LIMITS.maxAnswers) {
    problems.push(`Answer up to ${QUOTE_REQUEST_LIMITS.maxAnswers} questions.`);
  }
  for (const { answer } of draft.answers) {
    const trimmed = answer.trim();
    if (trimmed.length === 0) problems.push("Answer every question or remove it.");
    else if (trimmed.length > QUOTE_REQUEST_LIMITS.maxAnswer) {
      problems.push("Keep each answer under 1,000 characters.");
    }
  }
  return problems;
}
```

In `packages/core/src/projects/state-machine.ts`, rename the private `OPEN` to an exported `OPEN_PROJECT_STATUSES` (`export const OPEN_PROJECT_STATUSES: readonly ProjectStatus[] = [...]`) and update its one use (the `cancel` rule's `from`).

Export the module from `packages/core/src/index.ts` (follow the existing `export * from` lines).

- [ ] **Step 4: Run** `pnpm test packages/core` → PASS.

- [ ] **Step 5: Commit** `feat(core): validate a quote request and export the open statuses`.

---

### Task 2: db — client name, request answers, open-request count

**Files:**
- Modify: `packages/db/src/schema/projects.ts` (two columns on `project`)
- Create: migration via `pnpm -F db db:generate`
- Modify: `packages/db/src/repositories/projects.ts` (add `countOpenWebRequests`; confirm the file name — it is the repository that already queries `project`)
- Test: `packages/db/src/repositories/projects.test.ts` (or the existing test file for that repository)
- Maybe modify: `packages/db/src/testing/db.ts` (`seedProject`) only if the type check requires it

- [ ] **Step 1: Schema.** On the `project` table add:

```ts
    // Who asked, from the seller-page request form (sellers design §4.2); null for admin-started projects.
    clientName: text("client_name"),
    // The intake answers as {question, answer} pairs, in the order the questions were shown.
    requestAnswers: jsonb("request_answers").$type<QuoteRequestAnswer[]>().notNull().default([]),
```

Import `type QuoteRequestAnswer` from `@jendal-workspace/core`. Add `sql` default for jsonb if drizzle requires it: `default(sql`'[]'::jsonb`)` — check how `addItems` on `amendment` defaults (it uses `.notNull()` without a default and always sets it); if `default([])` does not type-check, use `.default(sql`'[]'::jsonb`)`.

- [ ] **Step 2: Generate the migration.** `pnpm -F db db:generate`, name it when prompted (or rename the folder) `r3c_quote_request`. Read the generated SQL: two ALTER TABLE ADD COLUMN statements, `request_answers` with `'[]'::jsonb` default.

- [ ] **Step 3: Failing test** for `countOpenWebRequests(db, { teamId, clientEmail })`: seed a services team (`seedServicesTeamWithAdmin`), then projects with `source: "web"` and `clientEmail` — two in open statuses (`quoting`, `in_progress`), one `completed`, one `cancelled`, one with `source: "admin"` in `quoting`, one web request for another email. Expect 2. Check `seedProject` in `packages/db/src/testing/db.ts` first: if it does not accept `source`/`clientEmail`/`status` overrides, extend it minimally (existing callers must keep working).

- [ ] **Step 4: Implement** in the projects repository:

```ts
export async function countOpenWebRequests(
  db: DbExecutor,
  input: { teamId: string; clientEmail: string },
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(project)
    .where(
      and(
        eq(project.teamId, input.teamId),
        eq(project.clientEmail, input.clientEmail),
        eq(project.source, "web"),
        inArray(project.status, OPEN_PROJECT_STATUSES),
      )
    );
  return row?.count ?? 0;
}
```

(`count` from `drizzle-orm`; `OPEN_PROJECT_STATUSES` from core.)

- [ ] **Step 5: Run** `pnpm test packages/db` and `pnpm check-types` → PASS (fix `seedProject` fallout if any).

- [ ] **Step 6: Commit** `feat(db): a project records who asked and their answers`.

---

### Task 3: email — the two templates

**Files:**
- Modify: `packages/email/src/templates.ts`
- Test: `packages/email/src/templates.test.ts` (create if missing)

- [ ] **Step 1: Failing test.** `quoteRequestLinkEmail({ clientName: "Jo", teamName: "Walk Crew", url: "https://payleor.com/c/t" })`: subject is "Your request to Walk Crew", text contains the URL, html contains the escaped URL and "Hi Jo,". `quoteRequestNoticeEmail({ teamName: "Walk Crew", clientName: "Jo <b>", clientEmail: "jo@x.com", serviceName: "Logo refresh", description: "A new logo", answers: [{ question: "Colors?", answer: "Blue" }], url: "https://admin.payleor.com/walk-crew/projects/p1" })`: subject "New request from Jo <b>". Actually the subject must be safe too: assert the subject uses the raw name but the html escapes it (`Jo &lt;b&gt;` appears, `<b>` does not). Text version lists the service, description and the answer lines.

- [ ] **Step 2: Run** the test → FAIL (functions do not exist).

- [ ] **Step 3: Implement** in `templates.ts`, reusing the private `render`/`renderHtml` and `escapeHtml`:

```ts
export function quoteRequestLinkEmail(input: { clientName: string; teamName: string; url: string }): EmailContent {
  return render({
    subject: `Your request to ${input.teamName}`,
    name: input.clientName,
    intro: `${input.teamName} received your request. Follow it, and accept or discuss the quote, on your private page:`,
    action: "Open your page",
    url: input.url,
    outro: "Keep this link; it is the way back to your page. If you did not send this request, you can ignore this email.",
  });
}

export function quoteRequestNoticeEmail(input: {
  teamName: string;
  clientName: string;
  clientEmail: string;
  serviceName: string;
  description: string;
  answers: { question: string; answer: string }[];
  url: string;
}): EmailContent {
  const answerLines = input.answers.map(({ question, answer }) => `${question}\n${answer}`);
  const details = [
    `${input.clientName} (${input.clientEmail}) asks about ${input.serviceName}:`,
    "",
    input.description,
    ...(answerLines.length > 0 ? ["", ...answerLines] : []),
  ].join("\n");
  return render({
    subject: `New request from ${input.clientName}`,
    name: input.teamName,
    intro: details,
    action: "Open the project",
    url: input.url,
    outro: "Reply to the client from the project page; their link is in their email.",
  });
}
```

Note: `render` escapes everything, so the multi-line intro is safe; the text version keeps the newlines.

- [ ] **Step 4: Run** `pnpm test packages/email` → PASS.

- [ ] **Step 5: Commit** `feat(email): templates for the quote request and the team notice`.

---

### Task 4: api + server — the email port on the context

**Files:**
- Modify: `packages/api/src/context.ts`
- Modify: `apps/server/src/services.ts`, `apps/server/src/context.ts`

- [ ] **Step 1:** In `packages/api/src/context.ts` add:

```ts
import type { Mailer } from "@jendal-workspace/email";

// Transactional email outside auth (quote requests). Absent in tests that do not send email.
export type EmailServices = {
  mailer: Mailer;
  // Absolute origins for links in emails, e.g. https://payleor.com and https://admin.payleor.com.
  siteOrigin: string;
  adminOrigin: string;
  // Sends that may outlive the response; awaited when absent.
  waitUntil?: (promise: Promise<unknown>) => void;
  onError?: (error: unknown) => void;
};
```

and on `Context`: `email?: EmailServices;` (placed with the other optional ports, with the comment "Absent in tests that do not send email; the request procedure then fails with PRECONDITION_FAILED").

- [ ] **Step 2:** In `apps/server/src/services.ts` add:

```ts
import type { EmailServices } from "@jendal-workspace/api/context";

// One mailer for auth and the api; links in emails point at the site and admin origins derived from
// BETTER_AUTH_URL (http://admin.localhost:3001 in dev, https://admin.payleor.com in production).
export function getEmailServices(executionCtx: ExecutionContext): EmailServices {
  const adminOrigin = ENV.BETTER_AUTH_URL;
  return {
    mailer: createMailer(ENV),
    siteOrigin: adminOrigin.replace("://admin.", "://"),
    adminOrigin,
    waitUntil: (promise) => executionCtx.waitUntil(promise),
    onError: logEmailError,
  };
}
```

(`createMailer`, `logEmailError` and `ENV` are already imported in this file.)

- [ ] **Step 3:** In `apps/server/src/context.ts`, `createContext` gains the execution context: change its signature to `createContext(c: HonoContext<AppEnv>, environment: TenantEnvironment, executionCtx: ExecutionContext)` (check the caller in `apps/server/src/index.ts` — the fetch handler has `executionCtx`; pass it through) and add `email: getEmailServices(executionCtx)` to the returned context.

- [ ] **Step 4:** `pnpm check-types` → PASS; `pnpm test packages/api apps/server` → PASS (no behavior change).

- [ ] **Step 5: Commit** `feat(api): an email port on the context`.

---

### Task 5: api — the `project.requestQuote` procedure

**Files:**
- Create: `packages/api/src/use-cases/requests.ts`
- Modify: `packages/api/src/routers/project.ts` (new public procedure)
- Test: `packages/api/src/routers/project.test.ts` (new describe block; reuse its caller/seeds pattern)

- [ ] **Step 1: Failing tests** in `project.test.ts` (follow the existing solo-quote test for the caller setup; pass `email: { mailer: createFakeMailer(), siteOrigin: "https://payleor.test", adminOrigin: "https://admin.payleor.test" }` into the caller context where noted — `createFakeMailer` from `@jendal-workspace/email/fake`):

  1. **Happy path**: services team with `status: "active"` (seedServicesTeam accepts a `status` option since R3b) and an active offering. Call `project.requestQuote` with `{ slug, offeringId, name: "Jo", email: "jo@x.com", description: "I need a landing page for my shop.", answers: [{ question: "Colors?", answer: "Blue" }], website: "" }`. Expect `{ ok: true }`; in the database a project in `quoting` with `source "web"`, `title` = the offering name, `brief` = the description, `clientEmail "jo@x.com"`, `clientName "Jo"`, the answers stored, settings' currency/fee bps copied, `createdById` null; one `project.created` outbox event; `mailer.sent` has two messages — one to `jo@x.com` (subject "Your request to …", html contains `https://payleor.test/c/`), one to the team's support email (seed the team with `support_email` set — check how seeds set it; if no seed support, update the row directly with drizzle in the test) with subject "New request from Jo". The client token in the link verifies with `verifyClientLink(TEST_AUTH_CONFIG.BETTER_AUTH_SECRET, token)` → the project id (extract the token from the sent html/text).
  2. **Honeypot**: `website: "https://spam.example"` → `{ ok: true }`, no project row, no emails.
  3. **Draft or suspended team** (status `draft`) → NOT_FOUND "Seller not found."; a store slug → NOT_FOUND.
  4. **Offering of another team** or an inactive offering → BAD_REQUEST "That service is not on this seller's list."
  5. **Open limit**: three open web requests for `jo@x.com` on the team (seed them) → BAD_REQUEST "You already have 3 open requests with this team. Wait for an answer before sending another."
  6. **Per-email rate limit**: hit the procedure 5 times with distinct emails? No — the per-email key includes the team: hit 5 times with the same email (delete the projects between calls or use emails… the key is email+team so pre-fill via `hitRequestLimit(ctx.db …)` 5 times with key `quote-request:email:{slug}:{email}`) → 6th call → TOO_MANY_REQUESTS "Too many requests. Wait a little and try again."
  7. **Per-IP limit**: caller headers `new Headers({ "cf-connecting-ip": "203.0.113.9" })`; pre-fill `quote-request:ip:203.0.113.9` to 20 → TOO_MANY_REQUESTS. Without the header the IP limit is skipped (assert a call succeeds with headers `new Headers()`).
  8. **Validation**: empty name → BAD_REQUEST with "Tell us your name."; description "short" → "Describe what you need in at least a sentence."
  9. **No email port** (context without `email`) → PRECONDITION_FAILED "Requests are not available right now."

  Write tests 1–3 first, see them fail (procedure does not exist), implement, then add the rest.

- [ ] **Step 2: Implement the use case** `packages/api/src/use-cases/requests.ts`:

```ts
import { isStorePublic, validateQuoteRequest, QUOTE_REQUEST_LIMITS, type QuoteRequestAnswer } from "@jendal-workspace/core";
import { findServicesOffering } from "@jendal-workspace/db/repositories/services-catalog";
import { countOpenWebRequests } from "@jendal-workspace/db/repositories/projects";
import { findServicesTeamBySlug, getServicesTeamSettings } from "@jendal-workspace/db/repositories/services-teams";
import { TRPCError } from "@trpc/server";

// same fail/runProjectTransaction shape as use-cases/projects.ts; copy the small helpers
// (fail with the code union incl. "NOT_FOUND", and runProjectTransaction) or export them there.

export type QuoteRequestInput = {
  slug: string;
  offeringId: string | null;
  name: string;
  email: string;
  description: string;
  answers: QuoteRequestAnswer[];
};

// Sellers design §4.2: a public request becomes a project in quoting, source "web".
export async function requestQuote(
  db: Database,
  input: QuoteRequestInput,
): Promise<{ projectId: string; teamName: string; serviceName: string; supportEmail: string | null }> {
  const team = await findServicesTeamBySlug(db, input.slug);
  if (!team || !isStorePublic({ status: team.status })) fail("NOT_FOUND", "Seller not found.");
  const email = input.email.trim().toLowerCase();
  const problems = validateQuoteRequest({ name: input.name, email, description: input.description, answers: input.answers });
  if (problems.length > 0) fail("BAD_REQUEST", problems[0]!);
  let serviceName = "Something else";
  if (input.offeringId) {
    const offering = await findServicesOffering(db, { id: input.offeringId, teamId: team.id });
    if (!offering?.active) fail("BAD_REQUEST", "That service is not on this seller's list.");
    serviceName = offering.name;
  }
  const open = await countOpenWebRequests(db, { teamId: team.id, clientEmail: email });
  if (open >= QUOTE_REQUEST_LIMITS.openPerEmailPerTeam) {
    fail("BAD_REQUEST", `You already have ${QUOTE_REQUEST_LIMITS.openPerEmailPerTeam} open requests with this team. Wait for an answer before sending another.`);
  }
  const settings = await getServicesTeamSettings(db, team.id);
  if (!settings) fail("NOT_FOUND", "Services team settings not found.");
  const [contact] = await db.select({ supportEmail: teamTable.supportEmail }).from(teamTable).where(eq(teamTable.id, team.id)).limit(1);

  const result = await runProjectTransaction(db, async (tx, uow) => { // returns { projectId }
    const [row] = await tx.insert(project).values({
      teamId: team.id,
      title: serviceName,
      brief: input.description.trim(),
      clientEmail: email,
      clientName: input.name.trim(),
      requestAnswers: input.answers.map(({ question, answer }) => ({ question: question.trim(), answer: answer.trim() })),
      offeringId: input.offeringId,
      source: "web",
      currency: settings.currency,
      managementFeeBps: settings.managementFeeBps,
      teamCutBps: settings.teamCutBps,
    }).returning();
    if (!row) throw new Error("Insert into project returned no row");
    await uow.apply({
      project: row,
      set: {},
      events: [{ type: "project.created", data: { projectId: row.id, title: row.title, clientEmail: email, clientDiscordId: null, channelId: null } }],
    });
    return { projectId: row.id };
  });
  return { ...result, teamName: team.name, serviceName, supportEmail: contact?.supportEmail ?? null };
}
```

(Exact imports: `project` from `@jendal-workspace/db/schema/projects`, `team` as `teamTable` from `@jendal-workspace/db/schema/organization`, `eq` from drizzle-orm. Copy `fail` and `runProjectTransaction` from `use-cases/projects.ts`, or export them there and import — pick the smaller diff; keep their behavior identical.)

- [ ] **Step 3: Implement the procedure** in `packages/api/src/routers/project.ts`:

```ts
const HOUR_MS = 3_600_000;

const requestQuoteInput = z.object({
  slug: z.string().min(1).max(63),
  offeringId: z.string().max(64).nullable(),
  name: z.string().max(QUOTE_REQUEST_LIMITS.maxName + 20),
  email: z.string().max(QUOTE_REQUEST_LIMITS.maxEmail),
  description: z.string().max(QUOTE_REQUEST_LIMITS.maxDescription + 100),
  answers: z.array(z.object({ question: z.string().max(200), answer: z.string().max(QUOTE_REQUEST_LIMITS.maxAnswer + 100) })).max(10),
  // Honeypot: bots fill the hidden "website" field; a filled field pretends success.
  website: z.string().max(200),
});

// inside projectRouter:
requestQuote: publicProcedure.input(requestQuoteInput).mutation(async ({ ctx, input }) => {
  if (input.website.trim() !== "") return { ok: true as const };
  const ip = ctx.headers.get("cf-connecting-ip")?.trim();
  if (ip) {
    const allowed = await hitRequestLimit(ctx.db, { key: `quote-request:ip:${ip}`, windowMs: HOUR_MS, max: 20 });
    if (!allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests. Wait a little and try again." });
  }
  const emailKey = `quote-request:email:${input.slug}:${input.email.trim().toLowerCase()}`;
  const emailAllowed = await hitRequestLimit(ctx.db, { key: emailKey, windowMs: HOUR_MS, max: 5 });
  if (!emailAllowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests. Wait a little and try again." });
  const emailServices = ctx.email;
  if (!emailServices) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Requests are not available right now." });

  const { projectId, teamName, serviceName, supportEmail } = await requestQuote(ctx.db, input);
  const token = await signClientLink(linkSecret(ctx.auth), projectId);
  const clientUrl = `${emailServices.siteOrigin}/c/${token}`;
  const linkContent = quoteRequestLinkEmail({ clientName: input.name.trim(), teamName, url: clientUrl });
  // The client's mail proves the address, so its failure is the request's failure.
  await emailServices.mailer.send({
    sender: "invoices", onBehalfOf: teamName, replyTo: supportEmail ?? undefined, tag: "quote-request",
    to: input.email.trim().toLowerCase(), ...linkContent,
  });
  if (supportEmail) {
    const notice = quoteRequestNoticeEmail({
      teamName, clientName: input.name.trim(), clientEmail: input.email.trim().toLowerCase(),
      serviceName, description: input.description.trim(),
      answers: input.answers, url: `${emailServices.adminOrigin}/${input.slug}/projects/${projectId}`,
    });
    const send = emailServices.mailer.send({ sender: "invoices", onBehalfOf: teamName, tag: "quote-request-notice", to: supportEmail, ...notice })
      .catch((error) => emailServices.onError?.(error));
    if (emailServices.waitUntil) emailServices.waitUntil(send); else await send;
  }
  return { ok: true as const };
}),
```

Note: the use case must also return `serviceName` (add it to its return) so the notice names the service. Imports: `hitRequestLimit`, `QUOTE_REQUEST_LIMITS`, `quoteRequestLinkEmail`, `quoteRequestNoticeEmail` (`@jendal-workspace/email`), `requestQuote` from the new use case.

- [ ] **Step 4: Run** `pnpm test packages/api/src/routers/project.test.ts packages/api/src/use-cases` → all PASS. `pnpm check-types` → PASS.

- [ ] **Step 5: Commit** `feat(api): the quote request procedure with limits and emails`.

---

### Task 6: web — the request form page

**Files:**
- Create: `apps/web/src/app/store/request/page.tsx`
- Create: `apps/web/src/app/store/request/request-form.tsx`
- Test: none new (browser-verified in the walkthrough); keep type checks green

Facts: `apps/web/src/app/store/page.tsx` shows the server-component pattern (`fetchSellerPage()`, `notFound()`). Client components call tRPC through the shared browser proxy — copy the import and `useMutation` pattern from `apps/web/src/app/(site)/c/[token]/client-project.tsx` (`trpc.project.clientRequestChanges.mutationOptions(...)`). UI primitives from `@jendal-workspace/ui/components/*` in client components only.

- [ ] **Step 1: The server page** `apps/web/src/app/store/request/page.tsx`:

```tsx
import { notFound } from "next/navigation";

import { fetchSellerPage } from "@/lib/server-api";

import RequestForm from "./request-form";

export default async function RequestPage({ searchParams }: { searchParams: Promise<{ offering?: string }> }) {
  const page = await fetchSellerPage();
  if (!page || page.product !== "services") notFound();
  const { offering } = await searchParams;
  return <RequestForm page={page} preselectedOfferingId={offering ?? null} />;
}
```

- [ ] **Step 2: The form** `apps/web/src/app/store/request/request-form.tsx` (`"use client"`):

- Props: `{ page: SellerPageView; preselectedOfferingId: string | null }` (import the type from `@/lib/server-api` — it is a zod-inferred type, no server code is pulled into the client bundle; verify with `pnpm -F web check-types` and the dev server that this import is type-only safe: `import type { SellerPageView } from "@/lib/server-api"`).
- State: `offeringId` (the preselected id if it is an active offering of this page, else `null`), `name`, `email`, `description`, `answers` (a record question→answer), `website` (honeypot), `done` (boolean after success).
- Fields, each with a `<label>`: "Service" — a `<select>` with "Something else" plus every offering name; "What do you need?" — a textarea; when the selected offering has `intakeQuestions`, one text input per question (label = the question); "Your name" and "Your email". The honeypot: `<input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"` wrapped in a `div` with `className="hidden"` and a comment `// Honeypot: invisible to people, filled by bots`.
- Client-side check before submit: `validateQuoteRequest` from core (`{ name, email, description, answers }`); show the first problem in a `role="alert"` paragraph; the submit button is disabled while submitting.
- Submit: `useMutation(trpc.project.requestQuote.mutationOptions())` with input `{ slug: page.slug, offeringId, name, email, description, answers, website }`. On success set `done`. On error show the server message in the alert.
- Success panel (replaces the form): a heading "Request sent" and "We emailed {email} a link to your page. It is how you follow the request and answer the team." 
- Header above the form: `Request a quote from {page.name}` (h1) and a line naming the selected offering's usual price/days when one is selected (reuse `priceLabel`/`daysLabel` from `@/lib/offering-labels`).

- [ ] **Step 3:** `pnpm -F web check-types` → PASS. Start the dev stack if it is running and load `https://walk-crew.payleor.app/request` (walk-crew is published) to verify it renders — or leave browser verification to the walkthrough.

- [ ] **Step 4: Commit** `feat(web): the quote request form on the seller host`.

---

### Task 7: web — seller page links to the form

**Files:**
- Modify: `apps/web/src/components/seller-page/seller-page.tsx`
- Modify: `apps/web/src/app/admin/[storeSlug]/preview/seller-preview.tsx` (pass the public base)
- Test: extend `apps/web/src/lib/offering-labels.test.ts`? No — if there is a seller-page test extend it; otherwise browser-verified

- [ ] **Step 1:** In `seller-page.tsx`, replace the mailto link in `OfferingCard` with a link to the form:

```tsx
<a
  href={`${page.requestBase}/request?offering=${offering.id}`}
  aria-label={`Request a quote for ${offering.name}`}
  className={buttonVariants({ variant: "outline", size: "sm", className: "justify-self-start" })}
>
  Request a quote
</a>
```

`SellerPageContent` gains `requestBase: string` (the empty string on the store host, so links are relative; the absolute public origin in the admin preview). The `page.supportEmail ?` gate goes away (the form no longer needs it). Add a generic entry under the services list (only when there is at least one offering):

```tsx
<p className="text-sm text-muted-foreground">
  Looking for something else?{" "}
  <a href={`${page.requestBase}/request`} className="underline underline-offset-4">
    Request a quote
  </a>
</p>
```

- [ ] **Step 2:** `apps/web/src/app/store/page.tsx` passes `requestBase: ""` (`<SellerPage page={{ ...page, requestBase: "" }} />`). `seller-preview.tsx` passes `requestBase: url` (the public URL it already computes).

- [ ] **Step 3:** `pnpm -F web check-types` → PASS.

- [ ] **Step 4: Commit** `feat(web): the seller page links to the request form`.

---

### Task 8: web + api — the admin sees the request

**Files:**
- Modify: `packages/api/src/routers/project.ts` (`project.get` output) and its test
- Modify: `apps/web/src/app/admin/[storeSlug]/projects/[projectId]/project-detail.tsx` (and the page's data plumbing if the fields are fetched there)

- [ ] **Step 1:** Find what `project.get` returns (the detail query behind the admin project page) and add `clientName` and `requestAnswers` (from the project row) plus the existing `source`. Failing test in `project.test.ts`: a web request's detail includes the name and answers.

- [ ] **Step 2:** On the project detail page, when `source === "web"`, show a "Request" section above the brief: "Requested by {clientName} <{clientEmail}>", and when answers exist a definition list of question → answer. Match the page's existing typography (it is a client component; read its conventions first).

- [ ] **Step 3:** `pnpm test packages/api/src/routers/project.test.ts` and `pnpm -F web check-types` → PASS.

- [ ] **Step 4: Commit** `feat(api,web): the admin sees who asked and their answers`.

---

### Task 9: Full check and merge (controller)

- [ ] `pnpm test && pnpm check-types --force` in the worktree.
- [ ] Final whole-branch review by a fresh reviewer (exposure: the procedure is public — input validation, limits, honeypot, team gating; email content injection; the new jsonb column; RSC rules for the new page).
- [ ] Apply the migration to the dev database (`packages/db` `db:migrate` against the dev URL, as done in earlier runs), then merge into `main` with `--no-ff` and a message file. `pnpm install` in main.
- [ ] Restart the dev stack (delete `apps/web/node_modules/.vite`, clear the browser cache if the duplicate-React error appears). The tunnel keeps running.

---

### Task 10: Walkthrough (controller, real email, no payment)

walk-crew is published with two services and support email `walk-crew@agentmail.to` (an AgentMail inbox; check mail with the mdbm-agy-cli skill or the AgentMail API as in earlier walkthroughs).

1. On `https://walk-crew.payleor.app`, "Request a quote" on "Landing page design" opens `/request?offering=…` with the service preselected and its usual price/days line. Validation: submitting with an empty name shows "Tell us your name.".
2. Fill it (name "Walk Client", email `mdbm-agent@agentmail.to`, a sentence, answers) and submit. Success panel names the email address.
3. The client email arrives (subject "Your request to Walk Crew", from "Walk Crew via Payleor" invoices@payleor.com, reply-to walk-crew@agentmail.to). Open the `/c/{token}` link — the client page shows the project in quoting with the brief.
4. The team notice arrives at walk-crew@agentmail.to (subject "New request from Walk Client") with the description and answers; its link opens the admin project page, which shows the Request section.
5. Limits: two more requests with the same email succeed; the fourth answers "You already have 3 open requests with this team.…". (Clean up the extra projects in the dev database afterwards.)
6. Honeypot: `fetch("/trpc/project.requestQuote", …)` with `website` filled returns `{ ok: true }` and creates nothing.
7. The draft team walk-crew-solo's `/request` answers 404 (it is not published).
8. Record the outcome in this plan, and update the sellers design §11 run 3 row (3c done) and the §11.1 rows this run closes or adds.

---

## Outcome

Merged into `main` as `8d51ff2` (1092 tests, check-types clean). Commits: `a651928` (core validation and limits), `f52a21d` (`project.client_name` + `request_answers`, `countOpenWebRequests`), `df6d98e` + `49f6e28` (link and notice templates; review fixes: HTML intro newlines become `<br>`, subjects cannot carry CR/LF), `3e5afcb` + `fc4b2aa` (the email port on the api context), `fe1a96f` + `4a518ef` + `118f25f` (procedure and use case; review fixes: a failed client email fails the request with a generic message while the project stays, the notice gets trimmed answers, `onError` awaited), `2288abc` (the form page), `1d30786` (seller-page links), `5626dae` (admin Request section), `79df4de` (failing-mailer test from the final review). Migration `20261008234621_r3c_quote_request` applied to the dev database.

Deviations: the email port's `onError` takes `(error, { kind, to })` to match `logEmailError`, so `email-log.ts` widened its kind to `string`. The use case calls `isStorePublic` with an explicit `product: "services"` because `findServicesTeamBySlug` does not select `product`. The form's fields use native `required` attributes, so an empty submit shows the browser bubble; the custom "Tell us your name." shows once native validation passes (for example a spaces-only name).

Walkthrough (tunnel, signed in as Walk Through): the seller page's per-offering "Request a quote" links and the "Looking for something else?" link open `/request`; the form preselects the service and shows its usual price/days line. Submitting creates the project in quoting (source web, offering set, title from the offering or "Something else") and shows "Request sent" naming the client email. The client email arrived (subject "Your request to Walk Crew", from "Walk Crew via Payleor" invoices@payleor.com, reply-to walk-crew@agentmail.to, SPF/DKIM/DMARC pass); the `/c/{token}` link opens the client page showing "Quoting" and the brief. The team notice ("New request from Walk Client", description, admin project link) arrived and the admin project page shows the Request section ("Requested by Walk Client <…>", description). Limits: the third request with the same email succeeded, the fourth was refused with "You already have 3 open requests with this team.…". Honeypot: a `website`-filled call returned `{ ok: true }` and created nothing. walk-crew-solo's `/request` answers 404. The three walkthrough projects and their outbox rows were deleted afterwards.

Walkthrough caveat: `walk-crew@agentmail.to` is not an inbox the available AgentMail key can read (and the key cannot create inboxes), so the notice was verified by temporarily pointing walk-crew's `support_email` at `mdbm-agent@agentmail.to` for one request, then restoring it. Also note emailed links point at `https://payleor.com/c/…` in dev (site origin from `BETTER_AUTH_URL`), and AgentMail's list `preview` truncates long URLs — fetch the full message for the token.

Open follow-ups recorded in the design §11.1: the per-email limit is consumed before validation (griefing vector, bounded by the 20/h IP cap), the open-request count is a TOCTOU race, and the SellerPage `supportEmail` field is now dead.
