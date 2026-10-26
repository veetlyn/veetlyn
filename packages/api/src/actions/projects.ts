import {
  AMENDMENT_STATUSES,
  CONVERSATION_MESSAGE_KINDS,
  CURRENCIES,
  DELIVERY_STATUSES,
  PAYMENT_KINDS,
  PAYMENT_STATUSES,
  PROJECT_REFUND_PART_STATUSES,
  PROJECT_REFUND_STATUSES,
  PROJECT_STATUSES,
  QUOTE_STATUSES,
} from "@jendal-workspace/core";
import { z } from "zod";

import { refundClient } from "../use-cases/client-refunds";
import { getClientProjectView, getTeamProjectView, listVisibleProjects } from "../use-cases/project-views";
import { assignFreelancer, decideLateDeliveryRefund, MAX_TITLE, MIN_TITLE, setQualityRefund, startProject } from "../use-cases/projects";
import { listClientProjects } from "../use-cases/client-home";
import { defineAction } from "./define";
import { ActionError } from "./errors";
import { teamActorOf } from "./team-actor";

export const projectIdInput = z.object({ projectId: z.uuid() });

export const startProjectInput = z.object({
  title: z.string().max(200),
  brief: z.string().max(5000).default(""),
  clientEmail: z.string().max(200).default(""),
  clientDiscordId: z.string().max(64).default(""),
  clientName: z.string().max(200).default(""),
  channelId: z.string().max(64).default(""),
  offeringId: z.string().min(1).optional(),
});

export const assignInput = projectIdInput.extend({ freelancerId: z.string().min(1) });

export const projectStart = defineAction({
  name: "project.start",
  kind: "action",
  summary:
    `Start a project for a client: a title of ${MIN_TITLE} to ${MAX_TITLE} characters, an optional brief, the client's email or Discord id, and optionally the offering it comes from.`,
  input: startProjectInput,
  output: z.object({ projectId: z.uuid() }),
  scope: () => ({}),
  allow: [{ grant: "member" }],
  run: (context, input) => startProject(context.deps.db, teamActorOf(context), input),
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

export const projectLateRefundDecide = defineAction({
  name: "project.late_refund.decide",
  kind: "action",
  summary: "Confirm or waive the late-delivery refund the rules proposed, before the client accepts the delivery; admins only.",
  input: projectIdInput.extend({ decision: z.enum(["confirm", "waive"]) }),
  output: z.null(),
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "member" }],
  agent: "never",
  run: async (context, input) => {
    await decideLateDeliveryRefund(context.deps.db, teamActorOf(context), input);
    return null;
  },
});

export const projectQualityRefundSet = defineAction({
  name: "project.quality_refund.set",
  kind: "action",
  summary: "Set a quality refund off the final price, within the team rules' cap for the project's stage; 0 removes it. Admins only.",
  input: projectIdInput.extend({ amountMinor: z.int().min(0) }),
  output: z.null(),
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "member" }],
  agent: "never",
  run: async (context, input) => {
    await setQualityRefund(context.deps.db, teamActorOf(context), input);
    return null;
  },
});

export const projectList = defineAction({
  name: "project.list",
  kind: "query",
  summary: "List the team's projects the caller may see, with each one's status, currency and primary client's name.",
  input: z.object({}),
  output: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      status: z.enum(PROJECT_STATUSES),
      currency: z.enum(CURRENCIES),
      clientName: z.string().nullable(),
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
  summary: "Show one project to its team: its clients, quotes, amendments, payments, deliveries and the refund.",
  input: projectIdInput,
  output: null,
  surfaces: ["web"],
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "member" }],
  run: (context, input) => getTeamProjectView(context.deps, teamActorOf(context), input.projectId),
});

const freelancerOutput = z.object({ key: z.string(), name: z.string() }).nullable();
const itemOutput = z.object({ description: z.string(), amountMinor: z.int(), extraDays: z.int() });

// The client's view, also read by the plugin. The team's user ids and PayPal ids are never in it.
const clientViewOutput = z.object({
  project: z.object({
    id: z.uuid(),
    title: z.string(),
    brief: z.string(),
    status: z.enum(PROJECT_STATUSES),
    currency: z.enum(CURRENCIES),
    managementFeeBps: z.int(),
    finalPriceMinor: z.int().nullable(),
    declinedReason: z.string().nullable(),
    declinedAt: z.iso.datetime().nullable(),
  }),
  quotes: z.array(
    z.object({
      id: z.uuid(),
      freelancer: freelancerOutput,
      version: z.int(),
      status: z.enum(QUOTE_STATUSES),
      amountMinor: z.int(),
      deliveryDays: z.int(),
      createdAt: z.iso.datetime(),
      acceptedAt: z.iso.datetime().nullable(),
      items: z.array(itemOutput.extend({ id: z.uuid() })),
    }),
  ),
  amendments: z.array(
    z.object({
      id: z.uuid(),
      status: z.enum(AMENDMENT_STATUSES),
      note: z.string(),
      addItems: z.array(itemOutput),
      deltaMinor: z.int(),
      newAmountMinor: z.int(),
      extraDays: z.int(),
      createdAt: z.iso.datetime(),
    }),
  ),
  payments: z.array(
    z.object({
      payable: z.boolean(),
      id: z.uuid(),
      kind: z.enum(PAYMENT_KINDS),
      status: z.enum(PAYMENT_STATUSES),
      amountMinor: z.int(),
      refundedMinor: z.int(),
      lines: z.array(z.object({ kind: z.string(), label: z.string(), amountMinor: z.int() })),
      createdAt: z.iso.datetime(),
      processing: z.boolean(),
      // Relative to the team's site; it names the payment, never the amount.
      payPath: z.string().nullable(),
    }),
  ),
  deliveries: z.array(
    z.object({
      id: z.uuid(),
      status: z.enum(DELIVERY_STATUSES),
      note: z.string(),
      link: z.string(),
      clientNote: z.string().nullable(),
      createdAt: z.iso.datetime(),
      decidedAt: z.iso.datetime().nullable(),
      file: z.object({ name: z.string(), sizeBytes: z.int() }).nullable(),
    }),
  ),
  refund: z
    .object({
      amountMinor: z.int(),
      currency: z.string(),
      status: z.enum(PROJECT_REFUND_STATUSES),
      completedAt: z.iso.datetime().nullable(),
    })
    .nullable(),
  conversation: z.object({
    canWrite: z.boolean(),
    messages: z.array(
      z.object({
        id: z.uuid(),
        kind: z.enum(CONVERSATION_MESSAGE_KINDS),
        authorKind: z.enum(["client", "member", "system"]),
        authorName: z.string(),
        body: z.string(),
        replyToId: z.uuid().nullable(),
        createdAt: z.iso.datetime(),
        freelancer: freelancerOutput,
      }),
    ),
  }),
});

export const projectClientView = defineAction({
  name: "project.client_view",
  kind: "query",
  summary: "Show the client their project: each freelancer's quote and questions, the conversation, amendments, payments with pay links, deliveries, the refund and, for a declined request, the team's reason.",
  input: projectIdInput,
  output: clientViewOutput,
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "client" }],
  run: ({ deps }, input) => getClientProjectView(deps, input.projectId),
});

export const projectClientList = defineAction({
  name: "project.client_list",
  kind: "query",
  summary: "List the signed-in person's projects as a client, across teams, newest first: title, team, status, request date, the start of the brief and the link to the team's client page.",
  input: z.object({}),
  output: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      briefStart: z.string(),
      status: z.enum(PROJECT_STATUSES),
      createdAt: z.iso.datetime(),
      teamName: z.string(),
      teamSlug: z.string(),
      clientUrl: z.url().nullable(),
    }),
  ),
  scope: () => ({}),
  allow: [{ grant: "signed_in" }],
  run: ({ deps, actor }) => {
    if (actor.kind !== "user") throw new ActionError("internal", "A client list ran without a signed-in user.");
    return listClientProjects(deps, actor.userId);
  },
});
