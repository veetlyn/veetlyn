import { canServicesTeam } from "@jendal-workspace/core";
import { listTeamDisputes, listTeamPayments } from "@jendal-workspace/db/repositories/money";
import { z } from "zod";

import { defineAction } from "./define";
import { ActionError } from "./errors";
import { teamActorOf } from "./team-actor";

export const paymentList = defineAction({
  name: "payment.list",
  kind: "query",
  summary: "List the team's client payments, newest first, with each one's project, client, amount, PayPal fee and refunds. Admins only.",
  input: z.object({}),
  output: null,
  surfaces: ["web"],
  scope: () => ({}),
  allow: [{ grant: "member" }],
  run: async (context) => {
    const actor = teamActorOf(context);
    if (!canServicesTeam(actor.role, "approve_payouts")) throw new ActionError("forbidden", "Only an admin can see payments.");
    return listTeamPayments(context.deps.db, actor.teamId);
  },
});

export const disputeList = defineAction({
  name: "dispute.list",
  kind: "query",
  summary: "List the team's PayPal cases, open ones first, with each one's reason, status, amount and project. Admins only.",
  input: z.object({}),
  output: null,
  surfaces: ["web"],
  scope: () => ({}),
  allow: [{ grant: "member" }],
  run: async (context) => {
    const actor = teamActorOf(context);
    if (!canServicesTeam(actor.role, "resolve_cases")) throw new ActionError("forbidden", "Only an admin can see PayPal cases.");
    return listTeamDisputes(context.deps.db, actor.teamId);
  },
});

export const MONEY_ACTIONS = [paymentList, disputeList] as const;
