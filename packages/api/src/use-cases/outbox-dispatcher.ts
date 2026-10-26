import { conversationAccess, errorName, readableSpaces } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { DbExecutor } from "@jendal-workspace/db/executor";
import {
  applyDeliveryOutcome,
  claimDueOutboxDeliveries,
  getMemberNoticeEnabled,
  insertOutboxDeliveries,
  skipOutboxDelivery,
  teamHasOpenDispute,
  type OutboxDeliveryRow,
} from "@jendal-workspace/db/repositories/operating-model";
import { runInTransaction, type OutboxRow } from "@jendal-workspace/db/repositories/unit-of-work";
import { clientContact, clientIdentity, projectClient } from "@jendal-workspace/db/schema/contacts";
import { findLinkedContact, recordLinkEmail } from "@jendal-workspace/db/repositories/contacts";
import { user } from "@jendal-workspace/db/schema/auth";
import { team } from "@jendal-workspace/db/schema/organization";
import { outbox } from "@jendal-workspace/db/schema/outbox";
import { outboxDelivery } from "@jendal-workspace/db/schema/operating-model";
import { project } from "@jendal-workspace/db/schema/projects";
import { conversationMessage, memberDepartment } from "@jendal-workspace/db/schema/conversations";
import { memberNoticePreference } from "@jendal-workspace/db/schema/operating-model";
import { findProjectById } from "@jendal-workspace/db/repositories/projects";
import { listServicesTeamMembers } from "@jendal-workspace/db/repositories/services-teams";
import {
  clientNoticeEmail,
  disputeAlertEmail,
  memberNoticeEmail,
  orderDownloadEmail,
  quoteRequestLinkEmail,
  type ClientNoticeKey,
  type MemberNoticeKey,
} from "@jendal-workspace/email";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { signClientLink } from "../client-links";
import type { EmailServices } from "../context";
import { accessFactsFor } from "./conversations";

// The outbox notice pipeline (AGT-16): events become one delivery per recipient (idempotent on
// (outboxId, channel, recipient)), and due deliveries are sent through the mailer with the engine's
// backoff. Recipients and display text are resolved from the database, never from the request.

const readString = z.string().min(1).catch("");

const CLIENT_NOTICE_EVENTS = new Map<string, ClientNoticeKey>([
  ["quote.created", "quote_sent"],
  ["amendment.proposed", "quote_amended"],
  ["amendment.accepted", "quote_amended"],
  ["payment.created", "payment_requested"],
  ["delivery.submitted", "delivery_submitted"],
  ["refund.requested", "refund_pending"],
  ["refund.issued", "refund_issued"],
  ["project.declined", "request_declined"],
  // The scheduler's ladder events (run B1 task 7) reuse this pipeline.
  ["request.expired", "request_expired"],
  ["review.remind", "review_reminder"],
  ["project.auto_completed", "project_auto_completed"],
  ["project.abandoned", "project_abandoned"],
]);

const MEMBER_NOTICE_EVENTS = new Map<string, MemberNoticeKey>([
  ["project.created", "quote_request"],
  ["project.assigned", "quote_request"],
  ["member.leaving_notice", "leaving_notice"],
  ["quote.accepted", "quote_accepted"],
  ["payment.captured", "payment_paid"],
  ["delivery.changes_requested", "changes_requested"],
  ["delivery.accepted", "delivery_accepted"],
  // Scheduler-driven member notices.
  ["request.remind", "response_reminder"],
  ["member.update_remind", "update_reminder"],
  ["member.update_late", "late_update_mark"],
  ["member.warning", "strike_warning"],
  ["project.late_refund_proposed", "late_refund_proposed"],
]);

const PAYOUT_EVENTS = new Set(["payout.requested", "payout.approved", "payout.queued", "payout.sent", "payout.failed"]);
const DISPUTE_EVENTS = new Set(["dispute.opened", "dispute.updated", "dispute.resolved"]);

type ClientRecipient = { email: string; name: string; contactId: string; linkVersion: number };

async function projectClientRecipients(db: DbExecutor, projectId: string, teamId: string): Promise<ClientRecipient[]> {
  return db
    .select({ email: clientIdentity.value, name: clientContact.name, contactId: clientContact.id, linkVersion: projectClient.linkVersion })
    .from(projectClient)
    .innerJoin(clientContact, eq(clientContact.id, projectClient.contactId))
    .innerJoin(clientIdentity, and(eq(clientIdentity.contactId, clientContact.id), eq(clientIdentity.kind, "email")))
    .innerJoin(project, eq(project.id, projectClient.projectId))
    .where(and(eq(projectClient.projectId, projectId), eq(project.teamId, teamId), eq(clientContact.teamId, teamId)));
}

async function teamPeople(db: DbExecutor, teamId: string) {
  const [owner] = await db.select({ id: team.id, organizationId: team.organizationId }).from(team).where(eq(team.id, teamId)).limit(1);
  if (!owner) return [];
  return listServicesTeamMembers(db, owner);
}

async function adminEmails(db: DbExecutor, teamId: string): Promise<string[]> {
  return (await teamPeople(db, teamId)).filter((person) => person.role === "admin").map((person) => person.email);
}

async function eventMessage(db: DbExecutor, event: OutboxRow) {
  const messageId = readString.parse(event.data.messageId);
  if (event.type !== "message.posted" || !event.projectId || !messageId) return null;
  const [message] = await db.select({ authorKind: conversationMessage.authorKind, space: conversationMessage.space, kind: conversationMessage.kind })
    .from(conversationMessage).innerJoin(project, eq(project.id, conversationMessage.projectId)).where(and(
      eq(conversationMessage.id, messageId), eq(conversationMessage.projectId, event.projectId), eq(project.teamId, event.teamId),
    )).limit(1);
  return message ?? null;
}

type EventMessage = Awaited<ReturnType<typeof eventMessage>>;

function clientNoticeKey(event: OutboxRow, message: EventMessage): ClientNoticeKey | undefined {
  if (event.type === "message.posted") return message?.authorKind === "member" ? (message.kind === "question" ? "question_asked" : "seller_replied") : undefined;
  if (event.type === "project.auto_completed" && event.data.to !== "completed") return undefined;
  return CLIENT_NOTICE_EVENTS.get(event.type);
}

function memberNoticeKey(event: OutboxRow, message: EventMessage): MemberNoticeKey | undefined {
  if (event.type === "message.posted") return message?.authorKind === "client" ? "client_message" : undefined;
  return MEMBER_NOTICE_EVENTS.get(event.type);
}

async function memberRecipients(db: DbExecutor, event: OutboxRow): Promise<string[]> {
  if (PAYOUT_EVENTS.has(event.type)) return userEmails(db, readString.parse(event.data.memberUserId));
  if (DISPUTE_EVENTS.has(event.type) || event.type === "member.leaving_notice" || event.type === "project.late_refund_proposed") {
    return adminEmails(db, event.teamId);
  }
  if (!event.projectId) return [];
  const row = await findProjectById(db, event.projectId);
  if (!row || row.teamId !== event.teamId) return [];
  if (event.type === "project.created" && (row.source !== "web" || row.status !== "quoting")) return [];
  if (event.type === "project.assigned" && row.status !== "quoting") return [];
  const message = await eventMessage(db, event);
  if (!memberNoticeKey(event, message)) return [];
  const [people, departments, facts] = await Promise.all([
    teamPeople(db, event.teamId),
    db.select().from(memberDepartment).where(eq(memberDepartment.teamId, event.teamId)),
    accessFactsFor(db, row),
  ]);
  const space = message?.space ?? (["project.created", "project.assigned", "request.remind"].includes(event.type) ? "request" : "project");
  const emails = people.filter((person) => {
    if (event.type === "project.assigned" && person.userId !== row.assignedFreelancerId) return false;
    return readableSpaces(conversationAccess({
      kind: "member", role: person.role, userId: person.userId,
      departmentIds: departments.filter((department) => department.userId === person.userId).map((department) => department.departmentId),
    }, facts)).includes(space);
  }).map((person) => person.email);
  if (event.type === "project.created") {
    const [support] = await db.select({ email: team.supportEmail }).from(team).where(eq(team.id, event.teamId)).limit(1);
    if (support?.email) emails.push(support.email);
  }
  return [...new Set(emails)];
}

async function insertMemberNotices(db: DbExecutor, event: OutboxRow): Promise<number> {
  const emails = await memberRecipients(db, event);
  const inserted = await insertOutboxDeliveries(db, emails.map((recipient) => ({ outboxId: event.id, channel: "email_member", recipient })));
  if (inserted.length === 0) return 0;
  const disabled = await db.select({ email: user.email }).from(memberNoticePreference).innerJoin(user, eq(user.id, memberNoticePreference.userId)).where(and(
    eq(memberNoticePreference.teamId, event.teamId), eq(memberNoticePreference.projectNoticesEnabled, false), inArray(user.email, emails),
  ));
  for (const row of inserted) if (disabled.some((member) => member.email === row.recipient)) await skipOutboxDelivery(db, row.id);
  return inserted.length;
}

async function userEmails(db: DbExecutor, userId: string): Promise<string[]> {
  const rows = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
  return rows.map((row) => row.email);
}

async function userByEmail(db: DbExecutor, email: string): Promise<{ id: string; name: string } | null> {
  const [row] = await db.select({ id: user.id, name: user.name }).from(user).where(eq(user.email, email)).limit(1);
  return row ?? null;
}

// Creates the delivery rows for freshly written outbox events. Members who turned project notices
// off still get their row, marked skipped, so the event reads as handled for them too.
export async function fanOutOutboxEvents(deps: { db: DbExecutor }, events: readonly OutboxRow[]): Promise<number> {
  const { db } = deps;
  let created = 0;
  for (const event of events) {
    if (event.type === "order.paid") {
      const buyerEmail = readString.parse(event.data.buyerEmail);
      if (buyerEmail) created += (await insertOutboxDeliveries(db, [{ outboxId: event.id, channel: "email_client", recipient: buyerEmail }])).length;
      continue;
    }
    if (PAYOUT_EVENTS.has(event.type)) {
      created += await insertMemberNotices(db, event);
      continue;
    }
    if (DISPUTE_EVENTS.has(event.type)) {
      const recipients = [...new Set([readString.parse(event.data.alertEmail), ...await adminEmails(db, event.teamId)].filter(Boolean))];
      created += (await insertOutboxDeliveries(db, recipients.map((recipient) => ({ outboxId: event.id, channel: "email_dispute", recipient })))).length;
      continue;
    }
    if (event.type === "member.leaving_notice") { created += await insertMemberNotices(db, event); continue; }
    if (!event.projectId) continue;
    const owner = await findProjectById(db, event.projectId);
    if (!owner || owner.teamId !== event.teamId) continue;
    const message = await eventMessage(db, event);
    if (clientNoticeKey(event, message) || (event.type === "project.created" && owner.source === "web")) {
      const recipients = await projectClientRecipients(db, event.projectId, event.teamId);
      created += (
        await insertOutboxDeliveries(db, recipients.map((r) => ({ outboxId: event.id, channel: "email_client" as const, recipient: r.email })))
      ).length;
    }
    if (memberNoticeKey(event, message)) created += await insertMemberNotices(db, event);
  }
  return created;
}

export type DeliverOutboxResult = { sent: number; failed: number; skipped: number };

// Fan-out and its cursor commit together; a failed batch is safely retried on the next wake-up.
export async function fanOutPendingOutboxEvents(deps: { db: Database; now?: () => Date; limit?: number }): Promise<number> {
  return deps.db.transaction(async (tx) => {
    const events = await tx.select().from(outbox).where(isNull(outbox.noticesProcessedAt))
      .orderBy(outbox.createdAt, outbox.id).limit(deps.limit ?? 100).for("update", { skipLocked: true });
    if (events.length === 0) return 0;
    const created = await fanOutOutboxEvents({ db: tx }, events);
    await tx.update(outbox).set({ noticesProcessedAt: (deps.now ?? (() => new Date()))() }).where(inArray(outbox.id, events.map((event) => event.id)));
    return created;
  });
}

const noticeMessageSchema = z.strictObject({
  sender: z.enum(["accounts", "stores", "invoices", "payouts", "disputes", "billing"]),
  onBehalfOf: z.string().optional(), replyTo: z.string().optional(), tag: z.string().optional(),
  to: z.string(), subject: z.string(), text: z.string(), html: z.string(),
  delivery: z.strictObject({
    from: z.strictObject({ email: z.string(), name: z.string() }),
    replyTo: z.string(),
    tags: z.array(z.strictObject({ name: z.enum(["sender", "kind"]), value: z.string() })),
  }).optional(),
});
const storedNoticeSchema = z.strictObject({
  email: noticeMessageSchema,
  client: z.strictObject({ contactId: z.string(), linkVersion: z.number().int().nonnegative() }).nullable(),
});
const providerReceiptSchema = z.strictObject({ providerMessageId: z.string().min(1).optional() });

// Leave a margin inside the provider's 24-hour idempotency retention window.
const SAFE_PROVIDER_RETRY_MS = 23 * 3_600_000;

// Sends the due deliveries: claim under a row lock, build the content, send, and record the engine's
// outcome. A failed send reschedules itself; the 10-minute cron sweeps again.
export async function deliverDueOutboxDeliveries(
  deps: { db: Database; email: EmailServices; secret?: string; now?: () => Date; limit?: number; outboxIds?: readonly string[] },
): Promise<DeliverOutboxResult> {
  const clock = deps.now ?? (() => new Date());
  const result: DeliverOutboxResult = { sent: 0, failed: 0, skipped: 0 };
  await fanOutPendingOutboxEvents({ db: deps.db, now: clock, limit: Math.min(deps.limit ?? 25, 100) });
  // Claim just before each send, so later rows do not exhaust their leases waiting in a batch.
  for (let index = 0; index < (deps.limit ?? 25); index += 1) {
    const [record] = await claimDueOutboxDeliveries(deps.db, clock(), 1, deps.outboxIds);
    if (!record) break;
    if (!record.claimToken || !record.firstAttemptAt) throw new Error("Delivery claim is incomplete");
    try {
      const [event] = await deps.db.select().from(outbox).where(eq(outbox.id, record.outboxId));
      if (!event) {
        await skipOutboxDelivery(deps.db, record.id, record.claimToken);
        result.skipped += 1;
        continue;
      }
      const cached = record.message ? storedNoticeSchema.parse(record.message) : null;
      let client: ClientRecipient | null = null;
      if (record.channel === "email_client" && event.projectId) {
        client = (await projectClientRecipients(deps.db, event.projectId, event.teamId)).find((contact) => contact.email === record.recipient) ?? null;
        if (!client || (cached?.client && (cached.client.contactId !== client.contactId || cached.client.linkVersion !== client.linkVersion))) {
          await skipOutboxDelivery(deps.db, record.id, record.claimToken);
          result.skipped += 1;
          continue;
        }
      }
      if (record.channel === "email_member") {
        if (!(await memberRecipients(deps.db, event)).includes(record.recipient)) {
          await skipOutboxDelivery(deps.db, record.id, record.claimToken);
          result.skipped += 1;
          continue;
        }
        const member = await userByEmail(deps.db, record.recipient);
        if (member && !(await getMemberNoticeEnabled(deps.db, event.teamId, member.id))) {
          await skipOutboxDelivery(deps.db, record.id, record.claimToken);
          result.skipped += 1;
          continue;
        }
      }
      if (record.channel === "email_dispute" && ![readString.parse(event.data.alertEmail), ...await adminEmails(deps.db, event.teamId)].includes(record.recipient)) {
        await skipOutboxDelivery(deps.db, record.id, record.claimToken);
        result.skipped += 1;
        continue;
      }
      if (PAYOUT_EVENTS.has(event.type) && await teamHasOpenDispute(deps.db, event.teamId)) {
        await deps.db.update(outboxDelivery).set({
          nextAttemptAt: new Date(clock().getTime() + 600_000), claimToken: null, claimExpiresAt: null,
          firstAttemptAt: record.attempts === 0 && record.message === null ? null : record.firstAttemptAt,
        }).where(and(eq(outboxDelivery.id, record.id), eq(outboxDelivery.status, "pending"), eq(outboxDelivery.claimToken, record.claimToken)));
        continue;
      }
      if (clock().getTime() - record.firstAttemptAt.getTime() >= SAFE_PROVIDER_RETRY_MS) {
        if (await applyDeliveryOutcome(deps.db, { record, at: clock(), error: "Delivery confirmation required after provider idempotency window", requireConfirmation: true })) result.failed += 1;
        continue;
      }
      const built = cached?.email ?? await buildMessage(deps, record, event, client);
      if (!built) {
        await skipOutboxDelivery(deps.db, record.id, record.claimToken);
        result.skipped += 1;
        continue;
      }
      const message = cached?.email ?? deps.email.mailer.prepare?.(built) ?? built;
      if (message.to !== record.recipient) throw new Error("Stored notice recipient mismatch");
      const snapshot = cached ?? { email: noticeMessageSchema.parse(message), client: client ? { contactId: client.contactId, linkVersion: client.linkVersion } : null };
      const [owned] = await deps.db.update(outboxDelivery).set({ message: snapshot }).where(and(
        eq(outboxDelivery.id, record.id), eq(outboxDelivery.status, "pending"),
        eq(outboxDelivery.claimToken, record.claimToken), gt(outboxDelivery.claimExpiresAt, clock()),
      )).returning({ id: outboxDelivery.id });
      if (!owned) continue;
      if (client && event.projectId) {
        const projectId = event.projectId;
        const destination = client;
        const recorded = await deps.db.transaction(async (tx) => {
          const linked = await findLinkedContact(tx, { projectId, contactId: destination.contactId, version: destination.linkVersion, emailed: true });
          if (!linked || linked.teamId !== event.teamId || linked.contactId !== destination.contactId) return false;
          if (!(await projectClientRecipients(tx, projectId, event.teamId)).some((recipient) => recipient.contactId === destination.contactId && recipient.email === record.recipient)) return false;
          await recordLinkEmail(tx, { projectId, contactId: destination.contactId, email: record.recipient });
          return true;
        });
        if (!recorded) {
          await skipOutboxDelivery(deps.db, record.id, record.claimToken);
          result.skipped += 1;
          continue;
        }
      }
      const receipt = providerReceiptSchema.optional().parse(await deps.email.mailer.send(message, { idempotencyKey: `delivery/${record.id}` }));
      if (await applyDeliveryOutcome(deps.db, { record, providerMessageId: receipt ? receipt.providerMessageId : undefined, at: clock() })) result.sent += 1;
    } catch (error) {
      if (await applyDeliveryOutcome(deps.db, { record, error: errorName(error), at: clock() })) result.failed += 1;
    }
  }
  return result;
}

type NoticeMessage = Parameters<EmailServices["mailer"]["send"]>[0];

async function buildMessage(
  deps: { db: Database; email: EmailServices; secret?: string },
  record: OutboxDeliveryRow,
  event: OutboxRow,
  recipient: ClientRecipient | null,
): Promise<NoticeMessage | null> {
  const base = { sender: "invoices" as const, tag: `notice-${event.type.replace(/[^a-z0-9_-]/g, "_")}`, to: record.recipient };

  if (event.type === "order.paid") {
    const slug = readString.parse(event.data.storeSlug);
    const token = readString.parse(event.data.token);
    const url = slug && token ? `${deps.email.storeOrigin(slug)}/orders/${token}` : readString.parse(event.data.url);
    if (!url) throw new Error("Order notice link is missing");
    const teamName = readString.parse(event.data.teamName) || "the store";
    return {
      ...base,
      sender: "stores",
      onBehalfOf: teamName,
      replyTo: readString.parse(event.data.supportEmail) || undefined,
      tag: "order-download",
      ...orderDownloadEmail({
        platformName: deps.email.platformName,
        teamName,
        productTitle: readString.parse(event.data.productTitle) || "your purchase",
        url,
      }),
    };
  }

  if (PAYOUT_EVENTS.has(event.type)) {
    const name = (await userByEmail(deps.db, record.recipient))?.name ?? "there";
    return {
      ...base,
      sender: "payouts",
      ...memberNoticeEmail({
        platformName: deps.email.platformName,
        name,
        teamName: readString.parse(event.data.teamName) || "your team",
        projectTitle: "",
        key: "payout_update",
        detail: payoutDetail(event),
        url: `${deps.email.dashOrigin}/payouts`,
      }),
    };
  }

  if (DISPUTE_EVENTS.has(event.type) && record.channel === "email_dispute") {
    const url = readString.parse(event.data.url);
    if (!url) return null;
    return {
      ...base,
      sender: "disputes",
      ...disputeAlertEmail({
        platformName: deps.email.platformName,
        teamName: readString.parse(event.data.teamName) || "your team",
        projectTitle: readString.parse(event.data.projectTitle) || "a project",
        disputeId: readString.parse(event.data.disputeId) || "case",
        reason: readString.parse(event.data.reason) || "unknown reason",
        amount: readString.parse(event.data.amount) || "",
        url,
      }),
    };
  }

  if (event.type === "member.leaving_notice" && record.channel === "email_member") {
    const [owner] = await deps.db.select({ slug: team.slug, name: team.name }).from(team).where(eq(team.id, event.teamId)).limit(1);
    if (!owner) return null;
    const [leaver] = await deps.db.select({ name: user.name }).from(user).where(eq(user.id, readString.parse(event.data.memberUserId))).limit(1);
    return { ...base, ...memberNoticeEmail({
      platformName: deps.email.platformName, name: "there", teamName: owner.name, projectTitle: leaver?.name ?? "A team member",
      key: "leaving_notice", detail: readString.parse(event.data.effectiveAt), url: `${deps.email.dashOrigin}/${owner.slug}/members`,
    }) };
  }
  if (!event.projectId) return null;
  const [row] = await deps.db
    .select({ title: project.title, source: project.source, slug: team.slug, name: team.name, supportEmail: team.supportEmail })
    .from(project)
    .innerJoin(team, eq(team.id, project.teamId))
    .where(and(eq(project.id, event.projectId), eq(project.teamId, event.teamId)))
    .limit(1);
  if (!row) return null;

  if (record.channel === "email_client") {
    const key = clientNoticeKey(event, await eventMessage(deps.db, event));
    const request = event.type === "project.created" && row.source === "web";
    if (!key && !request) return null;
    // Without the link secret (a send path outside a request) the client notice cannot carry its
    // signed link; the cron sweep, which has it, sends it instead.
    if (!deps.secret) throw new Error("Client notice signing is not configured");
    const contact = recipient;
    if (!contact) return null;
    const token = await signClientLink(deps.secret, { projectId: event.projectId, contactId: contact.contactId, version: contact.linkVersion });
    const url = `${deps.email.storeOrigin(row.slug)}/c/${token}`;
    if (request) return { ...base, tag: "quote-request", onBehalfOf: row.name, replyTo: row.supportEmail ?? undefined, ...quoteRequestLinkEmail({ platformName: deps.email.platformName, clientName: contact.name, teamName: row.name, url }) };
    if (!key) return null;
    return {
      ...base,
      onBehalfOf: row.name,
      ...clientNoticeEmail({
        platformName: deps.email.platformName,
        name: contact.name,
        teamName: row.name,
        projectTitle: row.title,
        key,
        detail: paymentDetail(event),
        url,
      }),
    };
  }

  if (record.channel === "email_member") {
    const key = memberNoticeKey(event, await eventMessage(deps.db, event));
    if (!key) return null;
    const name = (await userByEmail(deps.db, record.recipient))?.name ?? "there";
    return {
      ...base,
      ...memberNoticeEmail({
        platformName: deps.email.platformName,
        name,
        teamName: row.name,
        projectTitle: row.title,
        key,
        url: `${deps.email.dashOrigin}/${row.slug}/projects/${event.projectId}`,
      }),
    };
  }

  return null;
}

// Payment kinds read as words in the payment-requested notice.
function paymentDetail(event: OutboxRow): string | undefined {
  if (event.type !== "payment.created") return undefined;
  const kind = readString.parse(event.data.kind);
  if (kind === "deposit") return "the deposit";
  if (kind === "balance") return "the balance";
  if (kind === "top_up") return "an additional payment";
  return undefined;
}

function payoutDetail(event: OutboxRow): string | undefined {
  let status: string | undefined;
  switch (event.type) {
    case "payout.requested":
      status = "requested";
      break;
    case "payout.approved":
      status = "approved";
      break;
    case "payout.queued":
      status = "queued";
      break;
    case "payout.sent":
      status = "sent";
      break;
    case "payout.failed":
      status = "failed";
      break;
    default:
      status = undefined;
  }
  if (!status) return undefined;
  const amount = readString.parse(event.data.amount);
  return amount ? `${status} (${amount})` : status;
}

// Call inside the payout state transaction; committed events are dispatched separately.
export async function appendPayoutOutboxEvent(
  db: DbExecutor,
  input: {
    teamId: string;
    teamName?: string;
    type: "payout.requested" | "payout.approved" | "payout.queued" | "payout.sent" | "payout.failed";
    memberUserId: string;
    amountMinor: number;
    currency: string;
    payoutRequestId: string;
  },
): Promise<void> {
  const amount = `${input.currency} ${(input.amountMinor / 100).toFixed(2)}`;
  const teamName = input.teamName ?? (await db.select({ name: team.name }).from(team).where(eq(team.id, input.teamId)).limit(1))[0]?.name;
  if (!teamName) throw new Error("Payout notice team is missing");
  await runInTransaction(db, (_tx, uow) => uow.appendTeamOutbox({ teamId: input.teamId }, [{
    type: input.type,
    data: { memberUserId: input.memberUserId, payoutRequestId: input.payoutRequestId, amount, teamName },
  }]));
}
