import { errorName } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import {
  applyDeliveryOutcome,
  claimDueOutboxDeliveries,
  getMemberNoticeEnabled,
  insertOutboxDeliveries,
  skipOutboxDelivery,
  type OutboxDeliveryRow,
} from "@jendal-workspace/db/repositories/operating-model";
import { runInTransaction, type OutboxRow } from "@jendal-workspace/db/repositories/unit-of-work";
import { clientContact, clientIdentity, projectClient } from "@jendal-workspace/db/schema/contacts";
import { user } from "@jendal-workspace/db/schema/auth";
import { team } from "@jendal-workspace/db/schema/organization";
import { outbox } from "@jendal-workspace/db/schema/outbox";
import { project } from "@jendal-workspace/db/schema/projects";
import { servicesTeamMember } from "@jendal-workspace/db/schema/services-teams";
import {
  clientNoticeEmail,
  disputeAlertEmail,
  memberNoticeEmail,
  orderDownloadEmail,
  type ClientNoticeKey,
  type MemberNoticeKey,
} from "@jendal-workspace/email";
import { and, eq, inArray } from "drizzle-orm";
import { log } from "evlog";
import { z } from "zod";

import { signClientLink } from "../client-links";
import type { EmailServices } from "../context";

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
  ["refund.requested", "refund_issued"],
  // The scheduler's ladder events (run B1 task 7) reuse this pipeline.
  ["request.expired", "request_expired"],
  ["review.remind", "review_reminder"],
  ["project.auto_completed", "project_auto_completed"],
  ["project.abandoned", "project_abandoned"],
]);

const MEMBER_NOTICE_EVENTS = new Map<string, MemberNoticeKey>([
  ["quote.created", "quote_request"],
  ["quote.accepted", "quote_accepted"],
  ["payment.captured", "payment_paid"],
  ["delivery.changes_requested", "changes_requested"],
  ["delivery.accepted", "delivery_accepted"],
  // Scheduler-driven member notices.
  ["request.remind", "response_reminder"],
  ["member.update_remind", "update_reminder"],
  ["member.update_late", "late_update_mark"],
  ["member.warning", "strike_warning"],
]);

const PAYOUT_EVENTS = new Set(["payout.requested", "payout.approved", "payout.queued", "payout.sent", "payout.failed"]);
const DISPUTE_EVENTS = new Set(["dispute.opened", "dispute.updated", "dispute.resolved"]);

type ClientRecipient = { email: string; name: string; contactId: string; linkVersion: number };

async function projectClientRecipients(db: Database, projectId: string): Promise<ClientRecipient[]> {
  return db
    .select({ email: clientIdentity.value, name: clientContact.name, contactId: clientContact.id, linkVersion: projectClient.linkVersion })
    .from(projectClient)
    .innerJoin(clientContact, eq(clientContact.id, projectClient.contactId))
    .innerJoin(clientIdentity, and(eq(clientIdentity.contactId, clientContact.id), eq(clientIdentity.kind, "email")))
    .where(eq(projectClient.projectId, projectId));
}

async function projectMemberEmails(db: Database, projectId: string): Promise<string[]> {
  const [row] = await db
    .select({ freelancerId: project.assignedFreelancerId, teamId: project.teamId })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!row) return [];
  if (row.freelancerId) {
    const [member] = await db.select({ email: user.email }).from(user).where(eq(user.id, row.freelancerId)).limit(1);
    if (member) return [member.email];
  }
  // Without an assignee the team's admins hear it.
  const admins = await db
    .select({ email: user.email })
    .from(servicesTeamMember)
    .innerJoin(user, eq(user.id, servicesTeamMember.userId))
    .where(and(eq(servicesTeamMember.teamId, row.teamId), eq(servicesTeamMember.role, "admin")));
  return admins.map((admin) => admin.email);
}

async function userEmails(db: Database, userId: string): Promise<string[]> {
  const rows = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
  return rows.map((row) => row.email);
}

async function userByEmail(db: Database, email: string): Promise<{ id: string; name: string } | null> {
  const [row] = await db.select({ id: user.id, name: user.name }).from(user).where(eq(user.email, email)).limit(1);
  return row ?? null;
}

// Creates the delivery rows for freshly written outbox events. Members who turned project notices
// off still get their row, marked skipped, so the event reads as handled for them too.
export async function fanOutOutboxEvents(deps: { db: Database }, events: readonly OutboxRow[]): Promise<number> {
  const { db } = deps;
  let created = 0;
  for (const event of events) {
    if (event.type === "order.paid") {
      const buyerEmail = readString.parse(event.data.buyerEmail);
      if (buyerEmail) created += (await insertOutboxDeliveries(db, [{ outboxId: event.id, channel: "email_client", recipient: buyerEmail }])).length;
      continue;
    }
    if (PAYOUT_EVENTS.has(event.type)) {
      const memberUserId = readString.parse(event.data.memberUserId);
      for (const email of await userEmails(db, memberUserId)) {
        created += (await insertOutboxDeliveries(db, [{ outboxId: event.id, channel: "email_member", recipient: email }])).length;
      }
      continue;
    }
    if (DISPUTE_EVENTS.has(event.type)) {
      const alertEmail = readString.parse(event.data.alertEmail);
      if (alertEmail) created += (await insertOutboxDeliveries(db, [{ outboxId: event.id, channel: "email_dispute", recipient: alertEmail }])).length;
      continue;
    }
    if (!event.projectId) continue;
    const clientNotice = CLIENT_NOTICE_EVENTS.get(event.type);
    if (clientNotice) {
      const recipients = await projectClientRecipients(db, event.projectId);
      created += (
        await insertOutboxDeliveries(db, recipients.map((r) => ({ outboxId: event.id, channel: "email_client" as const, recipient: r.email })))
      ).length;
    }
    const memberNotice = MEMBER_NOTICE_EVENTS.get(event.type);
    if (memberNotice) {
      for (const email of await projectMemberEmails(db, event.projectId)) {
        const inserted = await insertOutboxDeliveries(db, [{ outboxId: event.id, channel: "email_member", recipient: email }]);
        created += inserted.length;
        const member = inserted.length > 0 ? await userByEmail(db, email) : null;
        if (member && !(await getMemberNoticeEnabled(db, event.teamId, member.id))) {
          for (const row of inserted) await skipOutboxDelivery(db, row.id);
        }
      }
    }
  }
  return created;
}

export type DeliverOutboxResult = { sent: number; failed: number; skipped: number };

// Sends the due deliveries: claim under a row lock, build the content, send, and record the engine's
// outcome. A failed send reschedules itself; the 10-minute cron sweeps again.
export async function deliverDueOutboxDeliveries(
  deps: { db: Database; email: EmailServices; secret?: string; now?: () => Date; limit?: number },
): Promise<DeliverOutboxResult> {
  const now = (deps.now ?? (() => new Date()))();
  const claimed = await claimDueOutboxDeliveries(deps.db, now, deps.limit ?? 25);
  const result: DeliverOutboxResult = { sent: 0, failed: 0, skipped: 0 };
  if (claimed.length === 0) return result;

  const ids = [...new Set(claimed.map((row) => row.outboxId))];
  const events = new Map((await deps.db.select().from(outbox).where(inArray(outbox.id, ids))).map((row) => [row.id, row]));
  for (const record of claimed) {
    const event = events.get(record.outboxId);
    if (!event) {
      await skipOutboxDelivery(deps.db, record.id);
      result.skipped += 1;
      continue;
    }
    const message = await buildMessage(deps, record, event);
    if (!message) {
      await skipOutboxDelivery(deps.db, record.id);
      result.skipped += 1;
      continue;
    }
    try {
      await deps.email.mailer.send(message);
      await applyDeliveryOutcome(deps.db, { record, at: now });
      result.sent += 1;
    } catch (error) {
      await applyDeliveryOutcome(deps.db, { record, error: errorName(error), at: now });
      result.failed += 1;
    }
  }
  return result;
}

type NoticeMessage = Parameters<EmailServices["mailer"]["send"]>[0];

async function buildMessage(
  deps: { db: Database; email: EmailServices; secret?: string },
  record: OutboxDeliveryRow,
  event: OutboxRow,
): Promise<NoticeMessage | null> {
  const base = { sender: "invoices" as const, tag: `notice-${event.type.replace(/[^a-z0-9_-]/g, "_")}`, to: record.recipient };

  if (event.type === "order.paid") {
    const url = readString.parse(event.data.url);
    if (!url) return null;
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

  if (!event.projectId) return null;
  const [row] = await deps.db
    .select({ title: project.title, slug: team.slug, name: team.name })
    .from(project)
    .innerJoin(team, eq(team.id, project.teamId))
    .where(eq(project.id, event.projectId))
    .limit(1);
  if (!row) return null;

  if (record.channel === "email_client") {
    const key = CLIENT_NOTICE_EVENTS.get(event.type);
    if (!key) return null;
    // Without the link secret (a send path outside a request) the client notice cannot carry its
    // signed link; the cron sweep, which has it, sends it instead.
    if (!deps.secret) return null;
    const contact = (await projectClientRecipients(deps.db, event.projectId)).find((r) => r.email === record.recipient);
    if (!contact) return null;
    const token = await signClientLink(deps.secret, { projectId: event.projectId, contactId: contact.contactId, version: contact.linkVersion });
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
        url: `${deps.email.storeOrigin(row.slug)}/c/${token}`,
      }),
    };
  }

  if (record.channel === "email_member") {
    const key = MEMBER_NOTICE_EVENTS.get(event.type);
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

// Team-scoped event written after a payout state change; the member hears it by email (backlog row 45).
export async function appendPayoutOutboxEvent(
  db: Database,
  input: {
    teamId: string;
    teamName: string;
    type: "payout.requested" | "payout.approved" | "payout.queued" | "payout.sent" | "payout.failed";
    memberUserId: string;
    amountMinor: number;
    currency: string;
    payoutRequestId: string;
  },
): Promise<void> {
  const amount = `${input.currency} ${(input.amountMinor / 100).toFixed(2)}`;
  try {
    const rows = await runInTransaction(db, (_tx, uow) =>
      uow.appendTeamOutbox(
        { teamId: input.teamId },
        [
          {
            type: input.type,
            data: { memberUserId: input.memberUserId, payoutRequestId: input.payoutRequestId, amount, teamName: input.teamName },
          },
        ],
      ),
    );
    await fanOutOutboxEvents({ db }, rows);
  } catch (error) {
    // A notice must never fail the money action it describes.
    log.warn({ action: "payout.outbox", payoutRequest: { id: input.payoutRequestId }, error: { name: errorName(error) } });
  }
}
