import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
  type SQLWrapper,
} from "drizzle-orm";

import type { DbExecutor, Transaction } from "../executor";
import { user } from "../schema/auth";
import { ledgerBalance, ledgerEntry, ledgerTransfer } from "../schema/ledger";
import { team } from "../schema/organization";
import {
  PAYOUT_REQUEST_MEMBER_OPEN_WHERE,
  payoutApproval,
  payoutDestination,
  payoutRequest,
  teamPayoutCredentials,
} from "../schema/payouts";
import { project } from "../schema/projects";

export type PayoutRequestRow = typeof payoutRequest.$inferSelect;
export type NewPayoutRequest = Pick<
  typeof payoutRequest.$inferInsert,
  "id" | "teamId" | "userId" | "currency" | "amountMinor" | "receiverPayerId"
> &
  Partial<Pick<typeof payoutRequest.$inferInsert, "source" | "projectId">>;
export type PayoutRequestPatch = Partial<
  Pick<
    typeof payoutRequest.$inferInsert,
    | "status"
    | "sendAttempt"
    | "paypalBatchId"
    | "paypalItemId"
    | "paypalItemStatus"
    | "feeEstimateMinor"
    | "sentMinor"
    | "feeMinor"
    | "failureMessage"
    | "reviewReason"
    | "uncertainAt"
    | "decidedByUserId"
    | "decidedAt"
    | "sentAt"
    | "settledAt"
    | "sendAfter"
    | "nextAttemptAt"
    | "waitCount"
    | "offlineReference"
    | "offlineBatchId"
    | "updatedAt"
  >
>;
export type TeamPayoutRequestRow = PayoutRequestRow & {
  memberName: string;
  memberEmail: string;
  projectTitle: string | null;
  approverIds: string[];
};
export type UserPayoutRequestRow = PayoutRequestRow & { teamName: string; teamSlug: string; projectTitle: string | null };

// Null when the member already has an open request of their own for this team (project payouts never conflict). The
// conflict target names the partial unique index (same columns and predicate), so the refusal does not abort the
// caller's transaction.
export async function insertPayoutRequest(tx: DbExecutor, values: NewPayoutRequest): Promise<PayoutRequestRow | null> {
  const [row] = await tx
    .insert(payoutRequest)
    .values(values)
    .onConflictDoNothing({
      target: [payoutRequest.teamId, payoutRequest.userId],
      where: PAYOUT_REQUEST_MEMBER_OPEN_WHERE,
    })
    .returning();
  return row ?? null;
}

export async function getPayoutRequest(db: DbExecutor, id: string): Promise<PayoutRequestRow | null> {
  const [row] = await db.select().from(payoutRequest).where(eq(payoutRequest.id, id)).limit(1);
  return row ?? null;
}

// Holds the request until the transaction ends, so a status change and its ledger post happen once.
export async function lockPayoutRequest(tx: Transaction, id: string): Promise<PayoutRequestRow | null> {
  const [row] = await tx.select().from(payoutRequest).where(eq(payoutRequest.id, id)).limit(1).for("update");
  return row ?? null;
}

// The team's request exported under this Payouts Web Customer ID, locked like lockPayoutRequest.
export async function lockPayoutRequestByOfflineReference(
  tx: Transaction,
  input: { teamId: string; reference: string },
): Promise<PayoutRequestRow | null> {
  const [row] = await tx
    .select()
    .from(payoutRequest)
    .where(and(eq(payoutRequest.teamId, input.teamId), eq(payoutRequest.offlineReference, input.reference)))
    .limit(1)
    .for("update");
  return row ?? null;
}

export async function updatePayoutRequest(tx: DbExecutor, id: string, patch: PayoutRequestPatch): Promise<PayoutRequestRow> {
  const [row] = await tx.update(payoutRequest).set(patch).where(eq(payoutRequest.id, id)).returning();
  if (!row) throw new Error(`Update of payout_request ${id} returned no row`);
  return row;
}

export async function listTeamPayoutRequests(db: DbExecutor, teamId: string): Promise<TeamPayoutRequestRow[]> {
  const rows = await db
    .select({
      request: payoutRequest,
      memberName: user.name,
      memberEmail: user.email,
      projectTitle: project.title,
      // json rather than text[]: the client runs without fetch_types, so it leaves arrays unparsed.
      approverIds: sql<string[]>`coalesce(
        (select json_agg(${payoutApproval.adminUserId} order by ${payoutApproval.createdAt})
          from ${payoutApproval} where ${payoutApproval.requestId} = ${payoutRequest.id}),
        '[]'::json
      )`,
    })
    .from(payoutRequest)
    .innerJoin(user, eq(user.id, payoutRequest.userId))
    .leftJoin(project, eq(project.id, payoutRequest.projectId))
    .where(eq(payoutRequest.teamId, teamId))
    .orderBy(desc(payoutRequest.createdAt), desc(payoutRequest.id));
  return rows.map(({ request, ...rest }) => ({ ...request, ...rest }));
}

export async function listUserPayoutRequests(db: DbExecutor, userId: string): Promise<UserPayoutRequestRow[]> {
  const rows = await db
    .select({ request: payoutRequest, teamName: team.name, teamSlug: team.slug, projectTitle: project.title })
    .from(payoutRequest)
    .innerJoin(team, eq(team.id, payoutRequest.teamId))
    .leftJoin(project, eq(project.id, payoutRequest.projectId))
    .where(eq(payoutRequest.userId, userId))
    .orderBy(desc(payoutRequest.createdAt), desc(payoutRequest.id));
  return rows.map(({ request, ...rest }) => ({ ...request, ...rest }));
}

// Least recently checked first: every check rewrites the row (or touches it), so a sweep with a limit moves on to
// the others instead of rereading the same requests while they stay pending.
export async function listSentPayoutRequests(
  db: DbExecutor,
  input: { sentBefore: Date; limit: number },
): Promise<PayoutRequestRow[]> {
  return db
    .select()
    .from(payoutRequest)
    .where(and(eq(payoutRequest.status, "sent"), lt(payoutRequest.sentAt, input.sentBefore)))
    .orderBy(asc(payoutRequest.updatedAt), asc(payoutRequest.id))
    .limit(input.limit);
}

// Moves a sent request to the back of the settle sweep. Only `sent` rows: on a `sending` row updated_at names the
// current send claim.
export async function touchSentPayoutRequest(db: DbExecutor, id: string): Promise<void> {
  await db
    .update(payoutRequest)
    .set({ updatedAt: new Date() })
    .where(and(eq(payoutRequest.id, id), eq(payoutRequest.status, "sent")));
}

// A payout PayPal may be working on with the team's current credentials.
export async function hasActivePayoutSend(db: DbExecutor, teamId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: payoutRequest.id })
    .from(payoutRequest)
    .where(and(eq(payoutRequest.teamId, teamId), inArray(payoutRequest.status, ["sending", "sent"])))
    .limit(1);
  return row !== undefined;
}

// False when this admin already approved the request.
export async function insertPayoutApproval(
  db: DbExecutor,
  input: { requestId: string; adminUserId: string },
): Promise<boolean> {
  const rows = await db.insert(payoutApproval).values(input).onConflictDoNothing().returning({ requestId: payoutApproval.requestId });
  return rows.length > 0;
}

export async function listPayoutApproverIds(db: DbExecutor, requestId: string): Promise<string[]> {
  const rows = await db
    .select({ adminUserId: payoutApproval.adminUserId })
    .from(payoutApproval)
    .where(eq(payoutApproval.requestId, requestId))
    .orderBy(asc(payoutApproval.createdAt), asc(payoutApproval.adminUserId));
  return rows.map((row) => row.adminUserId);
}

export type DuePayoutRequest = {
  request: PayoutRequestRow;
  team: { id: string; name: string; paypalMerchantId: string | null };
};

// Approved payouts whose payday and backoff have passed, longest waiting first. Teams without saved credentials are
// left out: their payouts wait for a Payouts Web export instead of being retried.
export async function listDuePayoutRequests(
  db: DbExecutor,
  input: { now: Date; limit: number },
): Promise<DuePayoutRequest[]> {
  return db
    .select({ request: payoutRequest, team: { id: team.id, name: team.name, paypalMerchantId: team.paypalMerchantId } })
    .from(payoutRequest)
    .innerJoin(teamPayoutCredentials, eq(teamPayoutCredentials.teamId, payoutRequest.teamId))
    .innerJoin(team, eq(team.id, payoutRequest.teamId))
    .where(
      and(
        eq(payoutRequest.status, "queued"),
        isNull(payoutRequest.uncertainAt),
        or(isNull(payoutRequest.sendAfter), lte(payoutRequest.sendAfter, input.now)),
        or(isNull(payoutRequest.nextAttemptAt), lte(payoutRequest.nextAttemptAt, input.now)),
      ),
    )
    .orderBy(
      asc(sql`coalesce(${payoutRequest.nextAttemptAt}, ${payoutRequest.sendAfter}, ${payoutRequest.decidedAt})`),
      asc(payoutRequest.id),
    )
    .limit(input.limit);
}

// Queued payouts of the team still waiting for a later payday move to `sendAfter`; the rest of their decision stays.
export async function rescheduleWaitingPayouts(
  db: DbExecutor,
  input: { teamId: string; now: Date; sendAfter: Date },
): Promise<number> {
  const rows = await db
    .update(payoutRequest)
    .set({ sendAfter: input.sendAfter, updatedAt: input.now })
    .where(
      and(
        eq(payoutRequest.teamId, input.teamId),
        eq(payoutRequest.status, "queued"),
        gt(payoutRequest.sendAfter, input.now),
      ),
    )
    .returning({ id: payoutRequest.id });
  return rows.length;
}

export type CompletedProjectWithoutPayout = {
  projectId: string;
  title: string;
  freelancerId: string;
  memberName: string;
  earningsMinor: number;
  currency: PayoutRequestRow["currency"];
  completedAt: Date;
};

// What the member earned from the team's completed projects that completed after `completedAfter` and have no payout
// yet, in `currency`: money still inside the hold, which no project payout may take. The member and currency may be
// columns of an outer query.
function earningsOnHoldSql(input: {
  teamId: string;
  memberId: SQLWrapper | string;
  currency: SQLWrapper | string;
  completedAfter: Date;
}): SQL<string> {
  // Compared as UTC wall time, as drizzle writes and reads these timestamp columns.
  const completedAfter = input.completedAfter.toISOString();
  return sql<string>`coalesce((
    select sum(held_entry.amount_minor)
    from project held_project
    join ledger_transfer held_transfer
      on held_transfer.team_id = held_project.team_id
      and held_transfer.kind = 'completion'
      and held_transfer.reference = 'completion:' || held_project.id
    join ledger_entry held_entry
      on held_entry.transfer_id = held_transfer.id
      and held_entry.account = 'owed:' || held_project.assigned_freelancer_id || ':available'
    where held_project.team_id = ${input.teamId}
      and held_project.status = 'completed'
      and held_project.assigned_freelancer_id = ${input.memberId}
      and held_entry.currency = ${input.currency}
      and held_transfer.created_at > ${completedAfter}::timestamp
      and not exists (select 1 from payout_request held_payout where held_payout.project_id = held_project.id)
  ), 0)`;
}

export async function earningsOnHoldMinor(
  db: DbExecutor,
  input: { teamId: string; memberId: string; currency: PayoutRequestRow["currency"]; completedAfter: Date },
): Promise<number> {
  const [row] = await db.select({ minor: earningsOnHoldSql(input) }).from(team).where(eq(team.id, input.teamId));
  return Number(row?.minor ?? 0);
}

// Completed projects of the team whose completion credited the assigned member before `completedBefore` and that have
// no payout yet. The completion transfer's time is the completion time. A project's payout is its earnings capped at
// the member's available balance less their earnings still on hold, so projects where either is under
// `minAmountMinor` are left out: otherwise they would come back on every run and, past the limit, hide the projects
// that can be paid. `destination` picks members who can be paid (a verified PayPal destination and the 18+
// confirmation) or those who cannot yet.
export async function listCompletedProjectsWithoutPayout(
  db: DbExecutor,
  input: {
    teamId: string;
    completedBefore: Date;
    minAmountMinor: number;
    destination: "qualified" | "missing";
    limit: number;
  },
): Promise<CompletedProjectWithoutPayout[]> {
  const rows = await db
    .select({
      projectId: project.id,
      title: project.title,
      freelancerId: project.assignedFreelancerId,
      memberName: user.name,
      earningsMinor: ledgerEntry.amountMinor,
      currency: ledgerEntry.currency,
      completedAt: ledgerTransfer.createdAt,
    })
    .from(project)
    .innerJoin(
      ledgerTransfer,
      and(
        eq(ledgerTransfer.teamId, project.teamId),
        eq(ledgerTransfer.kind, "completion"),
        eq(ledgerTransfer.reference, sql`'completion:' || ${project.id}`),
      ),
    )
    .innerJoin(
      ledgerEntry,
      and(
        eq(ledgerEntry.transferId, ledgerTransfer.id),
        eq(ledgerEntry.account, sql`'owed:' || ${project.assignedFreelancerId} || ':available'`),
      ),
    )
    .innerJoin(
      ledgerBalance,
      and(
        eq(ledgerBalance.teamId, project.teamId),
        eq(ledgerBalance.account, ledgerEntry.account),
        eq(ledgerBalance.currency, ledgerEntry.currency),
      ),
    )
    .innerJoin(user, eq(user.id, project.assignedFreelancerId))
    .leftJoin(payoutDestination, eq(payoutDestination.userId, project.assignedFreelancerId))
    .leftJoin(payoutRequest, eq(payoutRequest.projectId, project.id))
    .where(
      and(
        eq(project.teamId, input.teamId),
        eq(project.status, "completed"),
        isNotNull(project.assignedFreelancerId),
        lte(ledgerTransfer.createdAt, input.completedBefore),
        gte(ledgerEntry.amountMinor, input.minAmountMinor),
        sql`${ledgerBalance.balanceMinor} - ${earningsOnHoldSql({
          teamId: input.teamId,
          memberId: project.assignedFreelancerId,
          currency: ledgerEntry.currency,
          completedAfter: input.completedBefore,
        })} >= ${input.minAmountMinor}`,
        input.destination === "qualified"
          ? isNotNull(payoutDestination.ageConfirmedAt)
          : isNull(payoutDestination.ageConfirmedAt),
        isNull(payoutRequest.id),
      ),
    )
    .orderBy(asc(ledgerTransfer.createdAt), asc(project.id))
    .limit(input.limit);
  return rows.flatMap(({ freelancerId, ...row }) => (freelancerId === null ? [] : [{ ...row, freelancerId }]));
}
