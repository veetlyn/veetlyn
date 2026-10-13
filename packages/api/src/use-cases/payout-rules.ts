import {
  type Currency,
  nextPaydayAt,
  type PayoutRulePreset,
  type PayoutRules,
  payoutRulesProblem,
  presetRules,
  type ServicesTeamRecord,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import { rescheduleWaitingPayouts } from "@jendal-workspace/db/repositories/payout-requests";
import { getPayoutRules, savePayoutRules, type StoredPayoutRules } from "@jendal-workspace/db/repositories/payout-rules";
import { getServicesTeamSettings, listServicesTeamMembers } from "@jendal-workspace/db/repositories/services-teams";
import { TRPCError } from "@trpc/server";

// Amounts are minor units in `currency`; an auto-approve amount of ANY_AMOUNT_MINOR means any amount. Projects
// completed before payCompletedProjectsSince are not paid out on their own.
export type PayoutRulesView = Omit<PayoutRules, "trustedMemberIds"> & {
  trustedMemberIds: string[];
  payCompletedProjectsSince: string | null;
  currency: Currency;
  adminCount: number;
};

export type PayoutRulesTeam = Pick<ServicesTeamRecord, "id" | "organizationId">;

type TeamFacts = { currency: Currency; memberIds: Set<string>; adminCount: number };

// Workspace owners and admins are listed as team admins too.
export function adminCountOf(members: readonly { role: string }[]): number {
  return members.filter((m) => m.role === "admin").length;
}

async function teamFacts(db: Database, team: PayoutRulesTeam): Promise<TeamFacts> {
  const [settings, members] = await Promise.all([getServicesTeamSettings(db, team.id), listServicesTeamMembers(db, team)]);
  return {
    currency: settings?.currency ?? "USD",
    memberIds: new Set(members.map((m) => m.userId)),
    adminCount: adminCountOf(members),
  };
}

function view(rules: StoredPayoutRules, facts: TeamFacts): PayoutRulesView {
  // A trusted member who left the team drops off the list shown and saved.
  return {
    ...rules,
    trustedMemberIds: rules.trustedMemberIds.filter((id) => facts.memberIds.has(id)),
    payCompletedProjectsSince: rules.payCompletedProjectsSince?.toISOString() ?? null,
    currency: facts.currency,
    adminCount: facts.adminCount,
  };
}

function badRequest(message: string): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message });
}

export async function getTeamPayoutRules(db: Database, team: PayoutRulesTeam): Promise<PayoutRulesView> {
  const [rules, facts] = await Promise.all([getPayoutRules(db, team.id), teamFacts(db, team)]);
  return view(rules, facts);
}

const paydayChanged = (before: PayoutRules, after: PayoutRules) =>
  before.payday !== after.payday ||
  before.paydayWeekday !== after.paydayWeekday ||
  before.paydayMonthDay !== after.paydayMonthDay;

// Turning paying completed projects on starts from now, so projects completed earlier are not paid out as a backlog.
function payCompletedProjectsSince(before: StoredPayoutRules, rules: PayoutRules, now: Date): Date | null {
  if (!rules.payCompletedProjects) return null;
  return before.payCompletedProjects ? (before.payCompletedProjectsSince ?? now) : now;
}

// A rules change applies to payouts decided after it, except the payday: queued payouts still waiting for one
// move to the new payday.
async function store(
  db: Database,
  input: { team: PayoutRulesTeam; before: StoredPayoutRules; rules: PayoutRules; facts: TeamFacts; now: Date },
): Promise<PayoutRulesView> {
  const problem = payoutRulesProblem(input.rules, { adminCount: input.facts.adminCount, currency: input.facts.currency });
  if (problem) throw badRequest(problem);
  const stored: StoredPayoutRules = {
    ...input.rules,
    payCompletedProjectsSince: payCompletedProjectsSince(input.before, input.rules, input.now),
  };
  await db.transaction(async (tx) => {
    await savePayoutRules(tx, input.team.id, stored);
    if (paydayChanged(input.before, input.rules)) {
      await rescheduleWaitingPayouts(tx, {
        teamId: input.team.id,
        now: input.now,
        sendAfter: nextPaydayAt(input.rules, input.now),
      });
    }
  });
  return view(stored, input.facts);
}

export async function saveTeamPayoutRules(
  db: Database,
  input: {
    team: PayoutRulesTeam;
    userId: string;
    rules: Omit<PayoutRules, "preset">;
    now?: Date;
  },
): Promise<PayoutRulesView> {
  const [before, facts] = await Promise.all([getPayoutRules(db, input.team.id), teamFacts(db, input.team)]);
  const wanted = [...new Set(input.rules.trustedMemberIds)];
  // Only ids being added must be current members; stored ids of members who left are dropped silently.
  const added = wanted.filter((id) => !before.trustedMemberIds.includes(id));
  if (added.some((id) => !facts.memberIds.has(id))) throw badRequest("Trusted members must be on the team.");
  if (added.includes(input.userId)) {
    throw badRequest("Another admin has to add you to the trusted list.");
  }
  const rules: PayoutRules = {
    ...input.rules,
    preset: "custom",
    trustedMemberIds: wanted.filter((id) => facts.memberIds.has(id)),
  };
  return store(db, { team: input.team, before, rules, facts, now: input.now ?? new Date() });
}

export async function applyPayoutRulesPreset(
  db: Database,
  input: { team: PayoutRulesTeam; preset: Exclude<PayoutRulePreset, "custom">; now?: Date },
): Promise<PayoutRulesView> {
  const [before, facts] = await Promise.all([getPayoutRules(db, input.team.id), teamFacts(db, input.team)]);
  const rules: PayoutRules = {
    ...presetRules(input.preset),
    trustedMemberIds: before.trustedMemberIds.filter((id) => facts.memberIds.has(id)),
  };
  return store(db, { team: input.team, before, rules, facts, now: input.now ?? new Date() });
}
