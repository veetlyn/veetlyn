import { listCompletedProjectsWithoutPayout, listDuePayoutRequests } from "@jendal-workspace/db/repositories/payout-requests";
import { listTeamsPayingCompletedProjects } from "@jendal-workspace/db/repositories/payout-rules";
import { log } from "evlog";

import { decisionRules } from "./payout-rules";
import { appendPayoutOutboxEvent } from "./outbox-dispatcher";
import { createProjectPayout, holdEndsBefore, type PayoutDeps, type RequestPayoutDeps, sendPayout } from "./payouts";
import { payPalErrorLog } from "./paypal-amounts";

const SWEEP_BATCH = 50;

// Payouts for completed projects past their team's hold, at most `limit` projects a run. Without payout services
// (or without the team's credentials) approved payouts are created and wait; one project failing does not stop the
// others.
export async function createProjectPayouts(
  deps: Omit<RequestPayoutDeps, "now">,
  input: { now: Date; limit?: number },
): Promise<{ created: number }> {
  let remaining = input.limit ?? SWEEP_BATCH;
  let created = 0;
  for (const team of await listTeamsPayingCompletedProjects(deps.db)) {
    if (remaining <= 0) break;
    const rules = await decisionRules(deps.db, team);
    // Null only when the rules were turned off since the team was listed.
    if (!rules.payCompletedProjectsSince) continue;
    const projects = await listCompletedProjectsWithoutPayout(deps.db, {
      teamId: team.id,
      completedSince: rules.payCompletedProjectsSince,
      completedBefore: holdEndsBefore(rules, input.now),
      minAmountMinor: rules.minimumPayoutMinor,
      destination: "qualified",
      limit: remaining,
    });
    remaining -= projects.length;
    for (const project of projects) {
      try {
        const row = await createProjectPayout(deps, { team, rules, project, now: input.now });
        if (row) {
          created++;
          await appendPayoutOutboxEvent(deps.db, {
            type: "payout.requested",
            teamId: team.id,
            teamName: team.name,
            memberUserId: row.userId,
            amountMinor: row.amountMinor,
            currency: row.currency,
            payoutRequestId: row.id,
          });
        }
      } catch (error) {
        log.error({
          action: "payout.project_sweep",
          team: { id: team.id },
          project: { id: project.projectId },
          error: payPalErrorLog(error),
        });
      }
    }
  }
  return { created };
}

// Approved payouts whose payday and next try have passed, on teams with automatic payouts, sent through the same path
// as Retry; one failing does not stop the others.
export async function sendDuePayouts(
  deps: Omit<PayoutDeps, "now">,
  input: { now: Date; limit?: number },
): Promise<{ sent: number; held: number }> {
  const due = await listDuePayoutRequests(deps.db, { now: input.now, limit: input.limit ?? SWEEP_BATCH });
  let sent = 0;
  let held = 0;
  for (const { request, team } of due) {
    try {
      const row = await sendPayout({ ...deps, now: () => input.now }, team, request.id);
      if (row.status === "sent") sent++;
      else if (row.status === "queued") held++;
    } catch (error) {
      log.error({
        action: "payout.send_sweep",
        payoutRequest: { id: request.id },
        team: { id: team.id },
        error: payPalErrorLog(error),
      });
    }
  }
  return { sent, held };
}
