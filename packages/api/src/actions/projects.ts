import {
  CURRENCIES,
  PROJECT_REFUND_PART_STATUSES,
  PROJECT_REFUND_STATUSES,
  PROJECT_STATUSES,
} from "@jendal-workspace/core";
import { z } from "zod";

import { linkSecret, signClientLink } from "../client-links";
import { refundClient } from "../use-cases/client-refunds";
import { getClientProjectView, getTeamProjectView, listVisibleProjects } from "../use-cases/project-views";
import { assignFreelancer, startProject } from "../use-cases/projects";
import { defineAction } from "./define";
import { teamActorOf } from "./team-actor";

export const projectIdInput = z.object({ projectId: z.uuid() });

export const startProjectInput = z.object({
  title: z.string().max(200),
  brief: z.string().max(5000).default(""),
  clientEmail: z.string().max(200).default(""),
  clientDiscordId: z.string().max(64).default(""),
  channelId: z.string().max(64).default(""),
  offeringId: z.string().min(1).optional(),
});

export const assignInput = projectIdInput.extend({ freelancerId: z.string().min(1) });

export const projectStart = defineAction({
  name: "project.start",
  kind: "action",
  summary:
    "Start a project for a client: a title of 3 to 120 characters, an optional brief, the client's email or Discord id, and optionally the offering it comes from.",
  input: startProjectInput,
  output: z.object({ projectId: z.uuid(), clientPath: z.string() }),
  scope: () => ({}),
  allow: [{ grant: "member" }],
  run: async (context, input) => {
    const { projectId } = await startProject(context.deps.db, teamActorOf(context), input);
    const clientToken = await signClientLink(linkSecret(context.deps.auth), projectId);
    return { projectId, clientPath: `/c/${clientToken}` };
  },
});

export const projectAssign = defineAction({
  name: "project.assign",
  kind: "action",
  summary: "Assign a team member as the project's freelancer before it is quoted; admins and managers only, not for solo sellers.",
  input: assignInput,
  output: z.null(),
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "member" }],
  run: (context, input) => assignFreelancer(context.deps.db, teamActorOf(context), input),
});

export const projectRefundClient = defineAction({
  name: "project.refund_client",
  kind: "action",
  summary:
    "Refund the client everything the project's refund owes them through PayPal, retrying the parts that failed; admins only.",
  input: projectIdInput,
  output: z.object({
    amountMinor: z.int(),
    currency: z.enum(CURRENCIES),
    status: z.enum(PROJECT_REFUND_STATUSES),
    completedAt: z.iso.datetime().nullable(),
    parts: z.array(
      z.object({
        paymentId: z.uuid(),
        amountMinor: z.int(),
        status: z.enum(PROJECT_REFUND_PART_STATUSES),
        sent: z.boolean(),
        failureMessage: z.string().nullable(),
      }),
    ),
  }),
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "member" }],
  agent: "never",
  run: (context, input) =>
    refundClient({ db: context.deps.db, paypal: context.deps.paypal }, teamActorOf(context), input),
});

export const projectList = defineAction({
  name: "project.list",
  kind: "query",
  summary: "List the team's projects the caller may see, with each one's status, currency and client contact.",
  input: z.object({}),
  output: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      status: z.enum(PROJECT_STATUSES),
      currency: z.enum(CURRENCIES),
      clientEmail: z.string().nullable(),
      clientDiscordId: z.string().nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
  scope: () => ({}),
  allow: [{ grant: "member" }],
  run: (context) => listVisibleProjects(context.deps.db, teamActorOf(context)),
});

export const projectGet = defineAction({
  name: "project.get",
  kind: "query",
  summary: "Show one project to its team: quotes, amendments, payments, deliveries, the refund and the client link.",
  input: projectIdInput,
  output: null,
  surfaces: ["web"],
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "member" }],
  run: (context, input) => getTeamProjectView(context.deps, teamActorOf(context), input.projectId),
});

export const projectClientView = defineAction({
  name: "project.client_view",
  kind: "query",
  summary: "Show the client their project page: quotes, amendments, payments with pay links, deliveries and the refund.",
  input: projectIdInput,
  output: null,
  surfaces: ["web"],
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "client" }],
  run: ({ deps }, input) => getClientProjectView(deps, input.projectId),
});
